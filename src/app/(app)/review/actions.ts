"use server";

import { and, asc, eq, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryFlashcards, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateFlashcards } from "@/lib/ai/flashcards";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { scheduleSm2 } from "@/lib/srs/sm2";
import { awardXp } from "@/lib/gamify/award";

export type DueCard = {
  id: string;
  question: string;
  answer: string;
  itemId: string | null;
  itemTitle: string | null;
};

/** Optional scope so the user can "study this folder" / "study this note"
 *  instead of the whole library — review where the knowledge lives. */
export type StudyScope = { folderId?: string | null; itemId?: string | null };

/** Cards due now (oldest first), capped for a single session. Optionally scoped
 *  to one folder (cards whose source item is in it) or one item. */
export async function fetchDueCards(
  userId: string,
  limit = 50,
  scope?: StudyScope,
): Promise<DueCard[]> {
  const conds = [eq(directoryFlashcards.userId, userId), lte(directoryFlashcards.dueDate, new Date())];
  if (scope?.itemId) conds.push(eq(directoryFlashcards.itemId, scope.itemId));
  if (scope?.folderId) conds.push(eq(directoryItems.folderId, scope.folderId));

  return db
    .select({
      id: directoryFlashcards.id,
      question: directoryFlashcards.question,
      answer: directoryFlashcards.answer,
      itemId: directoryFlashcards.itemId,
      itemTitle: directoryItems.title,
    })
    .from(directoryFlashcards)
    .leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
    .where(and(...conds))
    .orderBy(asc(directoryFlashcards.dueDate))
    .limit(limit);
}

/** Total + due counts for the dashboard header. Same optional scope as above. */
export async function fetchCardStats(
  userId: string,
  scope?: StudyScope,
): Promise<{ total: number; due: number }> {
  const conds = [eq(directoryFlashcards.userId, userId)];
  if (scope?.itemId) conds.push(eq(directoryFlashcards.itemId, scope.itemId));
  if (scope?.folderId) conds.push(eq(directoryItems.folderId, scope.folderId));
  const scoped = !!(scope?.itemId || scope?.folderId);

  const base = db
    .select({
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${directoryFlashcards.dueDate} <= now())::int`,
    })
    .from(directoryFlashcards);
  // Only join when scoping by folder (folder lives on the item, not the card).
  const q = scoped
    ? base.leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
    : base;
  const [row] = await q.where(and(...conds));
  return { total: row?.total ?? 0, due: row?.due ?? 0 };
}

/** Generate flashcards from a Directory item (manual trigger). */
export async function generateFlashcardsAction(itemId: string) {
  const { user } = await requireUser();

  // Resolve the authoritative source text by kind: notes use content, documents
  // use documents.full_text, saved articles use the article body. Reading
  // directory_items.content directly produced ZERO cards for saved articles
  // (they carry no content) and partial/stale text for documents.
  const resolved = await getDirectoryItemStudyText(user.id, itemId);
  if (!resolved) return { ok: false as const, error: "Item not found" };

  const cards = await generateFlashcards(resolved.title, resolved.text);
  if (cards.length === 0)
    return { ok: false as const, error: "Couldn't generate cards (no text or AI unavailable)" };

  // Idempotent regenerate: replace this item's existing cards so retries and
  // study-plan re-seeds never duplicate. Only runs after a successful
  // generation, so a transient AI failure can't wipe an existing deck. (Resets
  // SM-2 scheduling for this item's cards — expected for a regenerate.)
  await db
    .delete(directoryFlashcards)
    .where(and(eq(directoryFlashcards.userId, user.id), eq(directoryFlashcards.itemId, itemId)));
  await db.insert(directoryFlashcards).values(
    cards.map((c) => ({ userId: user.id, itemId, question: c.question, answer: c.answer })),
  );
  // Gamify: making a deck from an item is meaningful work — XP once per item.
  const xp = await awardXp(user.id, { source: "cards_made", itemId, refKind: "item_cards", refId: itemId });

  // /review is a redirect into the Study hub — revalidate the real page so the
  // Review deck + Overview card counts pick up the new cards.
  revalidatePath("/study");
  revalidatePath("/review");
  return { ok: true as const, count: cards.length, xp };
}

const GradeSchema = z.object({ id: z.string().uuid(), quality: z.number().int().min(0).max(5) });

/** Grade a card (0-5) and reschedule via SM-2. */
export async function gradeCardAction(input: { id: string; quality: number }) {
  const parsed = GradeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { user } = await requireUser();

  const [card] = await db
    .select({
      ease: directoryFlashcards.ease,
      intervalDays: directoryFlashcards.intervalDays,
      repetitions: directoryFlashcards.repetitions,
      itemId: directoryFlashcards.itemId,
    })
    .from(directoryFlashcards)
    .where(and(eq(directoryFlashcards.id, parsed.data.id), eq(directoryFlashcards.userId, user.id)))
    .limit(1);
  if (!card) return { ok: false as const, error: "Card not found" };

  const next = scheduleSm2(card, parsed.data.quality);
  await db
    .update(directoryFlashcards)
    .set({
      ease: next.ease,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      dueDate: next.dueDate,
      updatedAt: new Date(),
    })
    .where(and(eq(directoryFlashcards.id, parsed.data.id), eq(directoryFlashcards.userId, user.id)));
  // Gamify: every review earns XP (scaled by recall quality) for the card's
  // skill. Intentionally NOT idempotent — spaced reps each earn.
  const xp = await awardXp(user.id, {
    source: "card_graded",
    quality: parsed.data.quality,
    itemId: card.itemId,
  });

  // A grade reschedules the card (changes "Due now" + "Reviewed this week" on the
  // Overview). Without this the dashboard stats stayed frozen at page-load values.
  revalidatePath("/study");
  return { ok: true as const, xp };
}

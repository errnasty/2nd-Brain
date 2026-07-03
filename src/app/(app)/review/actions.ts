"use server";

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryFlashcards, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateFlashcards, rewriteFlashcard } from "@/lib/ai/flashcards";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { scheduleFsrs, qualityToRating, seedFromSm2, LEECH_LAPSES } from "@/lib/srs/fsrs";
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

/** Grade a card (0-5 quality, mapped to FSRS Again/Hard/Good/Easy) and
 *  reschedule via FSRS. Cards from before migration 0018 have NULL stability;
 *  their SM-2 state seeds the FSRS state on this first FSRS review. */
export async function gradeCardAction(input: { id: string; quality: number }) {
  const parsed = GradeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { user } = await requireUser();

  const [card] = await db
    .select({
      ease: directoryFlashcards.ease,
      intervalDays: directoryFlashcards.intervalDays,
      repetitions: directoryFlashcards.repetitions,
      stability: directoryFlashcards.stability,
      difficulty: directoryFlashcards.difficulty,
      lapses: directoryFlashcards.lapses,
      lastReviewedAt: directoryFlashcards.lastReviewedAt,
      dueDate: directoryFlashcards.dueDate,
      itemId: directoryFlashcards.itemId,
    })
    .from(directoryFlashcards)
    .where(and(eq(directoryFlashcards.id, parsed.data.id), eq(directoryFlashcards.userId, user.id)))
    .limit(1);
  if (!card) return { ok: false as const, error: "Card not found" };

  const now = new Date();
  const rating = qualityToRating(parsed.data.quality);
  // Prior FSRS state, or a seed from SM-2 for repeat cards migrating over.
  // A never-reviewed card (no lastReviewedAt, no repetitions) starts fresh.
  const reviewedBefore = card.lastReviewedAt != null || card.repetitions > 0;
  const state =
    card.stability != null && card.difficulty != null
      ? { stability: card.stability, difficulty: card.difficulty }
      : reviewedBefore
        ? seedFromSm2(card.ease, card.intervalDays)
        : null;
  // Days since the last review. Legacy rows have no lastReviewedAt; approximate
  // it as dueDate - interval (when that review scheduled this due date).
  const lastReview =
    card.lastReviewedAt ??
    (reviewedBefore ? new Date(card.dueDate.getTime() - card.intervalDays * 86_400_000) : now);
  const elapsedDays = Math.max(0, (now.getTime() - lastReview.getTime()) / 86_400_000);

  const next = scheduleFsrs(state, rating, elapsedDays, now);
  await db
    .update(directoryFlashcards)
    .set({
      stability: next.stability,
      difficulty: next.difficulty,
      lapses: card.lapses + (next.lapsed ? 1 : 0),
      lastReviewedAt: now,
      // Legacy columns kept current for stats + any un-migrated readers.
      intervalDays: next.intervalDays,
      repetitions: next.lapsed ? 0 : card.repetitions + 1,
      dueDate: next.dueDate,
      updatedAt: now,
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

const CreateCardSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(2000),
  itemId: z.string().uuid().nullish(),
});

/** Create a single flashcard by hand (Ask answers, reader highlights). Due
 *  immediately so it enters today's queue. */
export async function createFlashcardAction(input: {
  question: string;
  answer: string;
  itemId?: string | null;
}) {
  const parsed = CreateCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Question or answer is too short/long" };
  const { user } = await requireUser();

  const [row] = await db
    .insert(directoryFlashcards)
    .values({
      userId: user.id,
      itemId: parsed.data.itemId ?? null,
      question: parsed.data.question,
      answer: parsed.data.answer,
    })
    .returning({ id: directoryFlashcards.id });

  const xp = await awardXp(user.id, {
    source: "cards_made",
    itemId: parsed.data.itemId ?? null,
    refKind: "manual_card",
    refId: row.id,
  });
  revalidatePath("/study");
  return { ok: true as const, id: row.id, xp };
}

/** AI-generate cards from arbitrary text (e.g. an article's key takeaways) and
 *  add them to the deck. Unlike generateFlashcardsAction this appends — it
 *  never replaces an existing deck. */
export async function createCardsFromTextAction(input: { title: string; text: string }) {
  const title = (input.title ?? "").slice(0, 300);
  const text = (input.text ?? "").trim();
  if (!text) return { ok: false as const, error: "Nothing to make cards from" };
  const { user } = await requireUser();

  const cards = await generateFlashcards(title, text.slice(0, 6000));
  if (cards.length === 0)
    return { ok: false as const, error: "Couldn't generate cards (AI unavailable)" };

  await db.insert(directoryFlashcards).values(
    cards.map((c) => ({ userId: user.id, itemId: null, question: c.question, answer: c.answer })),
  );
  const xp = await awardXp(user.id, { source: "cards_made" });
  revalidatePath("/study");
  return { ok: true as const, count: cards.length, xp };
}

export type LeechCard = {
  id: string;
  question: string;
  answer: string;
  lapses: number;
  itemTitle: string | null;
};

/** Cards failed LEECH_LAPSES+ times — badly formulated, eating review time. */
export async function fetchLeeches(userId: string, limit = 10): Promise<LeechCard[]> {
  return db
    .select({
      id: directoryFlashcards.id,
      question: directoryFlashcards.question,
      answer: directoryFlashcards.answer,
      lapses: directoryFlashcards.lapses,
      itemTitle: directoryItems.title,
    })
    .from(directoryFlashcards)
    .leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
    .where(and(eq(directoryFlashcards.userId, userId), gte(directoryFlashcards.lapses, LEECH_LAPSES)))
    .orderBy(desc(directoryFlashcards.lapses))
    .limit(limit);
}

/** AI-rewrite a leech into a sharper card, reset its lapse count, and put it
 *  back in the queue as (effectively) a new card. */
export async function rewriteLeechAction(cardId: string) {
  const { user } = await requireUser();
  const [card] = await db
    .select({
      question: directoryFlashcards.question,
      answer: directoryFlashcards.answer,
    })
    .from(directoryFlashcards)
    .where(and(eq(directoryFlashcards.id, cardId), eq(directoryFlashcards.userId, user.id)))
    .limit(1);
  if (!card) return { ok: false as const, error: "Card not found" };

  const rewritten = await rewriteFlashcard(card.question, card.answer);
  if (!rewritten) return { ok: false as const, error: "Couldn't rewrite (AI unavailable)" };

  await db
    .update(directoryFlashcards)
    .set({
      question: rewritten.question,
      answer: rewritten.answer,
      // New formulation = new memory. Restart scheduling from scratch.
      stability: null,
      difficulty: null,
      lapses: 0,
      repetitions: 0,
      intervalDays: 0,
      lastReviewedAt: null,
      dueDate: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(directoryFlashcards.id, cardId), eq(directoryFlashcards.userId, user.id)));
  revalidatePath("/study");
  return { ok: true as const, card: rewritten };
}

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

export type DueCard = {
  id: string;
  question: string;
  answer: string;
  itemId: string | null;
  itemTitle: string | null;
};

/** Cards due now (oldest first), capped for a single session. */
export async function fetchDueCards(userId: string, limit = 50): Promise<DueCard[]> {
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
    .where(
      and(eq(directoryFlashcards.userId, userId), lte(directoryFlashcards.dueDate, new Date())),
    )
    .orderBy(asc(directoryFlashcards.dueDate))
    .limit(limit);
}

/** Total + due counts for the dashboard header. */
export async function fetchCardStats(userId: string): Promise<{ total: number; due: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${directoryFlashcards.dueDate} <= now())::int`,
    })
    .from(directoryFlashcards)
    .where(eq(directoryFlashcards.userId, userId));
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
  // /review is a redirect into the Study hub — revalidate the real page so the
  // Review deck + Overview card counts pick up the new cards.
  revalidatePath("/study");
  revalidatePath("/review");
  return { ok: true as const, count: cards.length };
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
  // A grade reschedules the card (changes "Due now" + "Reviewed this week" on the
  // Overview). Without this the dashboard stats stayed frozen at page-load values.
  revalidatePath("/study");
  return { ok: true as const };
}

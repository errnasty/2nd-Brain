"use server";

import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryFlashcards, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db/errors";

const PAGE_SIZE = 50;

export type CardRow = {
  id: string;
  question: string;
  answer: string;
  itemId: string | null;
  itemTitle: string | null;
  dueDate: Date;
  createdAt: Date;
};

export type CardsPage = { cards: CardRow[]; hasMore: boolean };

/**
 * All of a user's flashcards (not just due ones), for the Cards manager —
 * browse/search/edit/delete any card. Client-fetched (like the quiz picker)
 * rather than loaded on the Study page, so a large deck doesn't inflate every
 * Study hub visit.
 */
export async function fetchAllCardsAction(input: {
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<CardsPage> {
  const { user } = await requireUser();
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(200, Math.max(1, input.limit ?? PAGE_SIZE));
  const q = (input.q ?? "").trim();

  const conds = [eq(directoryFlashcards.userId, user.id)];
  if (q) {
    const pattern = `%${q}%`;
    conds.push(
      or(
        ilike(directoryFlashcards.question, pattern),
        ilike(directoryFlashcards.answer, pattern),
        ilike(directoryItems.title, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      id: directoryFlashcards.id,
      question: directoryFlashcards.question,
      answer: directoryFlashcards.answer,
      itemId: directoryFlashcards.itemId,
      itemTitle: directoryItems.title,
      dueDate: directoryFlashcards.dueDate,
      createdAt: directoryFlashcards.createdAt,
    })
    .from(directoryFlashcards)
    .leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
    .where(and(...conds))
    .orderBy(desc(directoryFlashcards.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { cards: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

const UpdateCardSchema = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(2000),
});

/**
 * Edit a card's wording in place. Deliberately does NOT touch FSRS scheduling
 * (stability/difficulty/due date) — same underlying knowledge, just clearer
 * text. (Contrast with the leech rewrite flow, which resets scheduling because
 * it's meant to replace a badly-formed card with a fresh one.)
 */
export async function updateFlashcardAction(input: { id: string; question: string; answer: string }) {
  const parsed = UpdateCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Question or answer is too short/long" };
  const { user } = await requireUser();

  try {
    const result = await db
      .update(directoryFlashcards)
      .set({ question: parsed.data.question, answer: parsed.data.answer, updatedAt: new Date() })
      .where(and(eq(directoryFlashcards.id, parsed.data.id), eq(directoryFlashcards.userId, user.id)))
      .returning({ id: directoryFlashcards.id });
    if (result.length === 0) return { ok: false as const, error: "Card not found" };

    revalidatePath("/study");
    return { ok: true as const };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't save this card");
    console.error("updateFlashcardAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

export async function deleteFlashcardsAction(ids: string[]) {
  const { user } = await requireUser();
  if (ids.length === 0) return { ok: true as const, count: 0 };

  try {
    const result = await db
      .delete(directoryFlashcards)
      .where(and(eq(directoryFlashcards.userId, user.id), inArray(directoryFlashcards.id, ids)))
      .returning({ id: directoryFlashcards.id });
    revalidatePath("/study");
    return { ok: true as const, count: result.length };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't delete these cards");
    console.error("deleteFlashcardsAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

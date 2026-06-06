"use server";

import { and, asc, eq, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryFlashcards, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateFlashcards } from "@/lib/ai/flashcards";
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
  const [item] = await db
    .select({ title: directoryItems.title, content: directoryItems.content })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, itemId), eq(directoryItems.userId, user.id)))
    .limit(1);
  if (!item) return { ok: false as const, error: "Item not found" };

  const cards = await generateFlashcards(item.title, item.content ?? "");
  if (cards.length === 0)
    return { ok: false as const, error: "Couldn't generate cards (no text or AI unavailable)" };

  await db.insert(directoryFlashcards).values(
    cards.map((c) => ({ userId: user.id, itemId, question: c.question, answer: c.answer })),
  );
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
  return { ok: true as const };
}

"use server";

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, directoryTasks, directoryFlashcards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { computeStreak, dayKey } from "@/lib/study/streak";

export type StudyStats = {
  itemsWeek: number;
  notesWeek: number;
  cardsReviewedWeek: number;
  dueToday: number;
  totalCards: number;
  streak: number;
};

const WEEK_MS = 7 * 86_400_000;
const SIXTY_DAYS_MS = 60 * 86_400_000;

/** Weekly activity counts + current streak. A few cheap aggregate queries. */
export async function fetchStudyStats(userId: string): Promise<StudyStats> {
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const sixtyAgo = new Date(Date.now() - SIXTY_DAYS_MS);

  const [itemRow, cardRow, itemDates, reviewDates] = await Promise.all([
    db
      .select({
        itemsWeek: sql<number>`count(*)::int`,
        notesWeek: sql<number>`count(*) filter (where ${directoryItems.kind} = 'user_note')::int`,
      })
      .from(directoryItems)
      .where(and(eq(directoryItems.userId, userId), gte(directoryItems.createdAt, weekAgo))),
    db
      .select({
        total: sql<number>`count(*)::int`,
        due: sql<number>`count(*) filter (where ${directoryFlashcards.dueDate} <= now())::int`,
        reviewedWeek: sql<number>`count(*) filter (where ${directoryFlashcards.updatedAt} >= ${weekAgo} and ${directoryFlashcards.updatedAt} > ${directoryFlashcards.createdAt})::int`,
      })
      .from(directoryFlashcards)
      .where(eq(directoryFlashcards.userId, userId)),
    db
      .select({ at: directoryItems.createdAt })
      .from(directoryItems)
      .where(and(eq(directoryItems.userId, userId), gte(directoryItems.createdAt, sixtyAgo))),
    db
      .select({ at: directoryFlashcards.updatedAt })
      .from(directoryFlashcards)
      .where(
        and(
          eq(directoryFlashcards.userId, userId),
          gte(directoryFlashcards.updatedAt, sixtyAgo),
          sql`${directoryFlashcards.updatedAt} > ${directoryFlashcards.createdAt}`,
        ),
      ),
  ]);

  const activeDays = new Set<string>();
  for (const r of itemDates) if (r.at) activeDays.add(dayKey(r.at));
  for (const r of reviewDates) if (r.at) activeDays.add(dayKey(r.at));

  return {
    itemsWeek: itemRow[0]?.itemsWeek ?? 0,
    notesWeek: itemRow[0]?.notesWeek ?? 0,
    cardsReviewedWeek: cardRow[0]?.reviewedWeek ?? 0,
    dueToday: cardRow[0]?.due ?? 0,
    totalCards: cardRow[0]?.total ?? 0,
    streak: computeStreak(activeDays),
  };
}

export type CalendarEntry = { id: string; due: string; kind: "task" | "card"; text: string };

/** Tasks + flashcards with due dates in [from, to]. Raw ISO so the client can
 *  bucket them by its own local day. */
export async function fetchCalendar(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarEntry[]> {
  const from = new Date(fromISO);
  const to = new Date(toISO);

  const [tasks, cards] = await Promise.all([
    db
      .select({ id: directoryTasks.id, due: directoryTasks.dueDate, text: directoryTasks.text })
      .from(directoryTasks)
      .where(
        and(
          eq(directoryTasks.userId, userId),
          eq(directoryTasks.done, false),
          isNotNull(directoryTasks.dueDate),
          gte(directoryTasks.dueDate, from),
          lte(directoryTasks.dueDate, to),
        ),
      ),
    db
      .select({ id: directoryFlashcards.id, due: directoryFlashcards.dueDate })
      .from(directoryFlashcards)
      .where(
        and(
          eq(directoryFlashcards.userId, userId),
          gte(directoryFlashcards.dueDate, from),
          lte(directoryFlashcards.dueDate, to),
        ),
      ),
  ]);

  const out: CalendarEntry[] = [];
  for (const t of tasks) if (t.due) out.push({ id: t.id, due: t.due.toISOString(), kind: "task", text: t.text });
  for (const c of cards) if (c.due) out.push({ id: c.id, due: c.due.toISOString(), kind: "card", text: "Flashcard review" });
  return out;
}

/** Client-callable wrapper for month navigation in the calendar. */
export async function fetchCalendarRange(fromISO: string, toISO: string): Promise<CalendarEntry[]> {
  const { user } = await requireUser();
  return fetchCalendar(user.id, fromISO, toISO);
}

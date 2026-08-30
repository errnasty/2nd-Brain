"use server";

import { and, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, directoryTasks, directoryFlashcards, directoryFolders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { computeStreak, dayKey } from "@/lib/study/streak";
import { awardXp, type AwardResult } from "@/lib/gamify/award";

export type SubjectRetention = { subject: string; pct: number; cards: number };

export type StudyStats = {
  itemsWeek: number;
  notesWeek: number;
  cardsReviewedWeek: number;
  dueToday: number;
  totalCards: number;
  streak: number;
  // #24 Recommended interleaved session: what's due right now.
  dueTasks: number;
  dueSubjects: string[];
  // #25 14-day trends (oldest→newest) for stat-card sparklines.
  itemsHistory: number[];
  reviewsHistory: number[];
  // #26/#27 Retention proxy per subject (host folder), best→worst.
  retentionBySubject: SubjectRetention[];
};

const WEEK_MS = 7 * 86_400_000;
const SIXTY_DAYS_MS = 60 * 86_400_000;
const HISTORY_DAYS = 14;

/**
 * Retention proxy from SM-2 state: blends ease (1.3→2.7 mapped to 0→1, 70%) with
 * maturity (reps capped at 5, 30%). No per-review history is stored, so this is
 * an estimate of how well a card is currently retained, not a measured recall.
 */
function cardRetention(ease: number, reps: number): number {
  const easePart = Math.max(0, Math.min(1, (ease - 1.3) / 1.4));
  const repPart = Math.min(reps, 5) / 5;
  return Math.round((easePart * 0.7 + repPart * 0.3) * 100);
}

/** Bucket timestamps into the last `days` daily counts (oldest→newest, local). */
function dailyHistory(dates: (Date | null)[], days: number): number[] {
  const keys: string[] = [];
  const idx = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86_400_000));
    idx.set(k, keys.length);
    keys.push(k);
  }
  const out = new Array(days).fill(0);
  for (const d of dates) {
    if (!d) continue;
    const i = idx.get(dayKey(d));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}

/** Weekly activity counts + current streak. A few cheap aggregate queries. */
export async function fetchStudyStats(userId: string): Promise<StudyStats> {
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const sixtyAgo = new Date(Date.now() - SIXTY_DAYS_MS);

  // allSettled, for the same reason the page uses it around this function: one
  // failing query must not blank the rest. It previously did — a single broken
  // count took out items-this-week, the streak, retention by subject and the
  // due-task count along with it, and the whole Overview tab read as zero.
  const settled = await Promise.allSettled([
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
        // Composed from the typed comparators so the date is encoded by the
        // column's own mapper. Interpolating a bare JS Date leaves Postgres to
        // infer the parameter's type from position, which it cannot always do.
        reviewedWeek: sql<number>`count(*) filter (where ${gte(directoryFlashcards.updatedAt, weekAgo)} and ${gt(directoryFlashcards.updatedAt, directoryFlashcards.createdAt)})::int`,
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
          gt(directoryFlashcards.updatedAt, directoryFlashcards.createdAt),
        ),
      ),
    // #26/#27 per-card SM-2 state + host folder (subject). Capped for power users.
    db
      .select({
        ease: directoryFlashcards.ease,
        reps: directoryFlashcards.repetitions,
        due: directoryFlashcards.dueDate,
        folder: directoryFolders.name,
      })
      .from(directoryFlashcards)
      .leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
      .leftJoin(directoryFolders, eq(directoryFolders.id, directoryItems.folderId))
      .where(eq(directoryFlashcards.userId, userId))
      .limit(2000),
    db
      .select({
        due: sql<number>`count(*) filter (where ${directoryTasks.dueDate} <= now())::int`,
      })
      .from(directoryTasks)
      .where(
        and(
          eq(directoryTasks.userId, userId),
          eq(directoryTasks.done, false),
          isNotNull(directoryTasks.dueDate),
        ),
      ),
  ]);

  for (const [name, r] of [
    ["items", settled[0]],
    ["cards", settled[1]],
    ["itemDates", settled[2]],
    ["reviewDates", settled[3]],
    ["cardStates", settled[4]],
    ["tasks", settled[5]],
  ] as const) {
    if (r.status === "rejected") {
      // The cause carries the Postgres code and the column it objected to;
      // Drizzle's own message is only the SQL it tried, which never says why.
      const err = r.reason;
      const cause = err instanceof Error ? err.cause : undefined;
      console.error(
        `fetchStudyStats ${name} failed:`,
        err instanceof Error ? err.message : err,
        cause ? `| cause: ${cause instanceof Error ? cause.message : String(cause)}` : "",
        cause && typeof cause === "object" && "code" in cause ? `| code: ${String((cause as { code: unknown }).code)}` : "",
      );
    }
  }

  const value = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === "fulfilled" ? r.value : fallback;

  const itemRow = value(settled[0], [] as { itemsWeek: number; notesWeek: number }[]);
  const cardRow = value(settled[1], [] as { total: number; due: number; reviewedWeek: number }[]);
  const itemDates = value(settled[2], [] as { at: Date | null }[]);
  const reviewDates = value(settled[3], [] as { at: Date | null }[]);
  const cardStates = value(settled[4], [] as {
    ease: number;
    reps: number;
    due: Date | null;
    folder: string | null;
  }[]);
  const taskRow = value(settled[5], [] as { due: number }[]);

  const activeDays = new Set<string>();
  for (const r of itemDates) if (r.at) activeDays.add(dayKey(r.at));
  for (const r of reviewDates) if (r.at) activeDays.add(dayKey(r.at));

  // Retention by subject + which subjects have due cards right now.
  const now = Date.now();
  const bySubject = new Map<string, { sum: number; cards: number }>();
  const dueSubjects = new Set<string>();
  for (const c of cardStates) {
    const subject = c.folder ?? "Unsorted";
    const agg = bySubject.get(subject) ?? { sum: 0, cards: 0 };
    agg.sum += cardRetention(c.ease, c.reps);
    agg.cards += 1;
    bySubject.set(subject, agg);
    if (c.due && new Date(c.due).getTime() <= now) dueSubjects.add(subject);
  }
  const retentionBySubject: SubjectRetention[] = [...bySubject.entries()]
    .map(([subject, a]) => ({ subject, pct: Math.round(a.sum / a.cards), cards: a.cards }))
    .sort((a, b) => b.pct - a.pct);

  return {
    itemsWeek: itemRow[0]?.itemsWeek ?? 0,
    notesWeek: itemRow[0]?.notesWeek ?? 0,
    cardsReviewedWeek: cardRow[0]?.reviewedWeek ?? 0,
    dueToday: cardRow[0]?.due ?? 0,
    totalCards: cardRow[0]?.total ?? 0,
    streak: computeStreak(activeDays),
    dueTasks: taskRow[0]?.due ?? 0,
    dueSubjects: [...dueSubjects],
    itemsHistory: dailyHistory(itemDates.map((r) => r.at), HISTORY_DAYS),
    reviewsHistory: dailyHistory(reviewDates.map((r) => r.at), HISTORY_DAYS),
    retentionBySubject,
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

/**
 * Award the completion bonus for finishing "Today's session" end to end.
 * Idempotent per day (refKind/refId), so re-running the recap or a stray
 * double-click can't farm it — the bonus is for showing up, once.
 */
export async function finishSessionAction(): Promise<{ ok: true; xp: AwardResult } | { ok: false; error: string }> {
  try {
    const { user } = await requireUser();
    const xp = await awardXp(user.id, {
      source: "session_complete",
      refKind: "session_complete",
      refId: dayKey(new Date()),
    });
    return { ok: true, xp };
  } catch {
    return { ok: false, error: "Couldn't record the session" };
  }
}

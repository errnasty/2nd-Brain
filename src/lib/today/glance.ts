import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryTasks, playerProfile } from "@/lib/db/schema";
import { fetchCardStats } from "@/app/(app)/review/actions";
import { fetchDailyDecksDue, type DailyDeckDue } from "@/lib/thinktank/daily";

export type TodayGlance = {
  dueCards: number;
  reviewMinutes: number;
  dailyDecks: DailyDeckDue[];
  deckCards: number;
  tasksDueToday: number;
  streakDays: number;
  dailyXp: number;
  dailyGoal: number;
};

const DAILY_GOAL = 100;

/** Open tasks whose due date is today or earlier — the "due today" count. */
async function fetchTasksDueToday(userId: string): Promise<number> {
  // End of today (local server time is fine — this is a soft nudge count).
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(directoryTasks)
    .where(
      and(
        eq(directoryTasks.userId, userId),
        eq(directoryTasks.done, false),
        lte(directoryTasks.dueDate, endOfToday),
      ),
    );
  return row?.count ?? 0;
}

/** Light streak/daily-XP read — avoids the heavy fetchGameState for the strip. */
async function fetchStreak(userId: string): Promise<{ streakDays: number; dailyXp: number }> {
  const [row] = await db
    .select({
      streakDays: playerProfile.streakDays,
      dailyXp: playerProfile.dailyXp,
      dailyDateKey: playerProfile.dailyDateKey,
    })
    .from(playerProfile)
    .where(eq(playerProfile.userId, userId))
    .limit(1);
  if (!row) return { streakDays: 0, dailyXp: 0 };
  const todayKey = new Date().toISOString().slice(0, 10);
  return { streakDays: row.streakDays, dailyXp: row.dailyDateKey === todayKey ? row.dailyXp : 0 };
}

/**
 * Everything the Today "at a glance" strip needs, in one parallel batch. Each
 * read is independently fail-soft: one slow/failed query yields a zero for
 * that stat, never a broken page.
 */
export async function fetchTodayGlance(userId: string): Promise<TodayGlance> {
  const [stats, decks, tasks, streak] = await Promise.allSettled([
    fetchCardStats(userId),
    fetchDailyDecksDue(userId),
    fetchTasksDueToday(userId),
    fetchStreak(userId),
  ]);
  const dueCards = stats.status === "fulfilled" ? stats.value.due : 0;
  const dailyDecks = decks.status === "fulfilled" ? decks.value : [];
  const deckCards = dailyDecks.reduce((sum, d) => sum + d.remaining, 0);
  const tasksDueToday = tasks.status === "fulfilled" ? tasks.value : 0;
  const { streakDays, dailyXp } =
    streak.status === "fulfilled" ? streak.value : { streakDays: 0, dailyXp: 0 };
  return {
    dueCards,
    // ~7s/card is a realistic reveal+grade pace; keeps the "about N min" honest.
    reviewMinutes: Math.max(1, Math.round((dueCards * 7) / 60)),
    dailyDecks,
    deckCards,
    tasksDueToday,
    streakDays,
    dailyXp,
    dailyGoal: DAILY_GOAL,
  };
}

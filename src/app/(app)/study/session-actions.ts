import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, directoryTasks, quizzes, skills } from "@/lib/db/schema";
import { fetchCardStats, fetchDueCards, type DueCard } from "../review/actions";
import type { TaskRow } from "../tasks/actions";
import type { QuizForTaking } from "./quiz-actions";

// A single session should feel finishable — cap the cards so "press start"
// isn't a 200-card marathon. (More come due tomorrow; that's the point.)
const SESSION_CARD_CAP = 20;

export type SessionPlan = {
  /** Due flashcards for this session (capped). */
  cards: DueCard[];
  /** Total due right now (may exceed cards.length — shown for context). */
  dueCount: number;
  /** Tasks due today or overdue. */
  overdueTasks: TaskRow[];
  /** One quiz to include — matched to the weakest skill, else most recent. */
  quiz: QuizForTaking | null;
  /** The skill the quiz targets, when one was matched. */
  weakestSkill: { name: string; emoji: string | null } | null;
};

/**
 * Assemble "today's session": the due cards, anything overdue, and one quiz —
 * so the Study hub can offer a single "press start" instead of making the user
 * decide what to work on. Server-only (called from the Study page); the plan is
 * handed to the client as props.
 */
export async function composeTodaySession(userId: string): Promise<SessionPlan> {
  const now = new Date();

  const [cards, stats, overdueTasks, weakestRows, quizList] = await Promise.all([
    fetchDueCards(userId, SESSION_CARD_CAP),
    fetchCardStats(userId),
    db
      .select({
        id: directoryTasks.id,
        itemId: directoryTasks.itemId,
        itemTitle: directoryItems.title,
        text: directoryTasks.text,
        done: directoryTasks.done,
        dueDate: directoryTasks.dueDate,
      })
      .from(directoryTasks)
      .innerJoin(directoryItems, eq(directoryItems.id, directoryTasks.itemId))
      .where(
        and(
          eq(directoryTasks.userId, userId),
          eq(directoryTasks.done, false),
          isNotNull(directoryTasks.dueDate),
          lte(directoryTasks.dueDate, now),
        ),
      )
      .orderBy(asc(directoryTasks.dueDate))
      .limit(10),
    // Weakest active skill: lowest level, then lowest xp, among skills with any
    // progress (xp > 0) so a brand-new empty skill isn't picked.
    db
      .select({ id: skills.id, name: skills.name, emoji: skills.emoji })
      .from(skills)
      .where(and(eq(skills.userId, userId), sql`${skills.xp} > 0`))
      .orderBy(asc(skills.level), asc(skills.xp))
      .limit(1),
    // Quiz metadata (not the question bodies yet) — few per user, matched in JS.
    db
      .select({ id: quizzes.id, itemIds: quizzes.itemIds })
      .from(quizzes)
      .where(eq(quizzes.userId, userId))
      .orderBy(desc(quizzes.createdAt)),
  ]);

  const weakest = weakestRows[0] ?? null;
  const weakestSkill = weakest ? { name: weakest.name, emoji: weakest.emoji } : null;

  // Choose a quiz: prefer one whose source items belong to the weakest skill;
  // otherwise the most recent quiz (quizList is already newest-first).
  let chosenQuizId: string | null = quizList[0]?.id ?? null;
  if (weakest && quizList.length > 0) {
    const skillItems = await db
      .select({ id: directoryItems.id })
      .from(directoryItems)
      .where(
        and(
          eq(directoryItems.userId, userId),
          sql`${directoryItems.metadata} ->> 'skillId' = ${weakest.id}`,
        ),
      )
      .limit(500);
    const skillItemIds = new Set(skillItems.map((r) => r.id));
    if (skillItemIds.size > 0) {
      const matched = quizList.find((q) => q.itemIds.some((id) => skillItemIds.has(id)));
      if (matched) chosenQuizId = matched.id;
    }
  }

  let quiz: QuizForTaking | null = null;
  if (chosenQuizId) {
    const [row] = await db
      .select({ id: quizzes.id, title: quizzes.title, questions: quizzes.questions, itemIds: quizzes.itemIds })
      .from(quizzes)
      .where(and(eq(quizzes.id, chosenQuizId), eq(quizzes.userId, userId)))
      .limit(1);
    if (row) quiz = row;
  }

  return { cards, dueCount: stats.due, overdueTasks, quiz, weakestSkill };
}

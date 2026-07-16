"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { quizzes, quizAttempts, type QuizQuestion, type QuizAnswer } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateQuiz } from "@/lib/ai/quiz";
import { aiAvailable } from "@/lib/ai/provider";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { awardXp } from "@/lib/gamify/award";
import { dbErrorMessage } from "@/lib/db/errors";
import { fetchDirectoryPage } from "@/lib/directory/query";

const MAX_ITEMS_PER_QUIZ = 10;

/** Lightweight item list for the "pick documents to quiz on" dialog. */
export type QuizItemOption = { id: string; title: string; kind: string };

export async function fetchQuizItemOptionsAction(): Promise<QuizItemOption[]> {
  const { user } = await requireUser();
  try {
    const page = await fetchDirectoryPage(user.id, { offset: 0, limit: 500, sort: "updated" });
    return page.items.map((i) => ({ id: i.id, title: i.title, kind: i.kind }));
  } catch (err) {
    console.error("fetchQuizItemOptionsAction failed:", dbErrorMessage(err, ""));
    return [];
  }
}

/** Generate a quiz (multiple-choice + open-ended mix) from one or more
 *  Directory items — the "select one or several documents" flow. */
export async function generateQuizAction(itemIds: string[]) {
  const ids = [...new Set(itemIds)].filter(Boolean).slice(0, MAX_ITEMS_PER_QUIZ);
  if (ids.length === 0) return { ok: false as const, error: "Select at least one document" };
  const { user } = await requireUser();

  try {
    const resolved = await Promise.all(ids.map((id) => getDirectoryItemStudyText(user.id, id)));
    const sources = resolved
      .map((r, i) => (r ? { title: r.title, text: r.text, itemId: ids[i] } : null))
      .filter((s): s is { title: string; text: string; itemId: string } => s !== null);
    if (sources.length === 0) return { ok: false as const, error: "None of the selected items were found" };

    const questions = await generateQuiz(sources.map(({ title, text }) => ({ title, text })));
    if (questions.length === 0) {
      // Distinguish WHY generation came back empty, same reasoning as flashcards.
      if (!sources.some((s) => s.text.trim()))
        return { ok: false as const, error: "These items have no text yet to quiz on" };
      if (!aiAvailable())
        return { ok: false as const, error: "AI isn't configured — add an API key in Settings" };
      return { ok: false as const, error: "Couldn't generate a quiz from this text — try again" };
    }

    const withIds: QuizQuestion[] = questions.map((q) => ({ ...q, id: randomUUID() }));
    const title =
      sources.length === 1
        ? sources[0].title
        : `Quiz: ${sources.map((s) => s.title).join(", ").slice(0, 200)}`;

    const [row] = await db
      .insert(quizzes)
      .values({
        userId: user.id,
        title,
        itemIds: sources.map((s) => s.itemId),
        questions: withIds,
      })
      .returning({ id: quizzes.id });

    // Gamify: making a quiz is meaningful work, same tier as making flashcards.
    // Only attribute a skill when there's a single unambiguous source item.
    const xp = await awardXp(user.id, {
      source: "quiz_made",
      itemId: sources.length === 1 ? sources[0].itemId : null,
      refKind: "quiz_made",
      refId: row.id,
    });

    revalidatePath("/study");
    return { ok: true as const, id: row.id, count: withIds.length, xp };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't create the quiz");
    console.error("generateQuizAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

export type QuizListItem = {
  id: string;
  title: string;
  itemCount: number;
  questionCount: number;
  createdAt: Date;
  attemptCount: number;
  bestScore: number | null;
  bestTotal: number | null;
  lastCompletedAt: Date | null;
};

/** All of a user's quizzes with their attempt history rolled up — the Study
 *  hub's Quiz tab list (title, score history, retake). */
export async function fetchQuizzesAction(userId: string): Promise<QuizListItem[]> {
  const rows = await db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      itemIds: quizzes.itemIds,
      questions: quizzes.questions,
      createdAt: quizzes.createdAt,
    })
    .from(quizzes)
    .where(eq(quizzes.userId, userId))
    .orderBy(desc(quizzes.createdAt));
  if (rows.length === 0) return [];

  const attempts = await db
    .select({
      quizId: quizAttempts.quizId,
      score: quizAttempts.score,
      total: quizAttempts.total,
      completedAt: quizAttempts.completedAt,
    })
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), inArray(quizAttempts.quizId, rows.map((r) => r.id))),
    );

  const byQuiz = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byQuiz.get(a.quizId);
    if (list) list.push(a);
    else byQuiz.set(a.quizId, [a]);
  }

  return rows.map((r) => {
    const list = byQuiz.get(r.id) ?? [];
    const best = list.reduce<{ score: number; total: number } | null>(
      (acc, a) => (!acc || a.score / a.total > acc.score / acc.total ? { score: a.score, total: a.total } : acc),
      null,
    );
    const last = list.reduce<Date | null>((acc, a) => (!acc || a.completedAt > acc ? a.completedAt : acc), null);
    return {
      id: r.id,
      title: r.title,
      itemCount: r.itemIds.length,
      questionCount: r.questions.length,
      createdAt: r.createdAt,
      attemptCount: list.length,
      bestScore: best?.score ?? null,
      bestTotal: best?.total ?? null,
      lastCompletedAt: last,
    };
  });
}

export type QuizForTaking = { id: string; title: string; questions: QuizQuestion[] };

/** One quiz's full question set, for taking/retaking it. */
export async function fetchQuizAction(quizId: string): Promise<QuizForTaking | null> {
  const { user } = await requireUser();
  const [row] = await db
    .select({ id: quizzes.id, title: quizzes.title, questions: quizzes.questions })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)))
    .limit(1);
  return row ?? null;
}

const AnswerSchema = z.discriminatedUnion("type", [
  z.object({ questionId: z.string(), type: z.literal("mc"), selectedIndex: z.number().int().min(0).max(3) }),
  z.object({ questionId: z.string(), type: z.literal("open"), selfCorrect: z.boolean() }),
]);
const SubmitSchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(AnswerSchema).min(1),
});

/** Grade a completed attempt (mc auto-graded by correctIndex, open self-graded
 *  by the taker) and save it to history. */
export async function submitQuizAttemptAction(input: { quizId: string; answers: QuizAnswer[] }) {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid answers" };
  const { user } = await requireUser();

  try {
    const [quiz] = await db
      .select({ questions: quizzes.questions })
      .from(quizzes)
      .where(and(eq(quizzes.id, parsed.data.quizId), eq(quizzes.userId, user.id)))
      .limit(1);
    if (!quiz) return { ok: false as const, error: "Quiz not found" };

    const byId = new Map(quiz.questions.map((q) => [q.id, q]));
    let score = 0;
    for (const a of parsed.data.answers) {
      const q = byId.get(a.questionId);
      if (!q) continue;
      if (q.type === "mc" && a.type === "mc" && a.selectedIndex === q.correctIndex) score++;
      else if (q.type === "open" && a.type === "open" && a.selfCorrect) score++;
    }
    const total = quiz.questions.length;

    const [row] = await db
      .insert(quizAttempts)
      .values({
        userId: user.id,
        quizId: parsed.data.quizId,
        answers: parsed.data.answers,
        score,
        total,
      })
      .returning({ id: quizAttempts.id });

    // XP scales with score% (mirrors card_graded scaling with recall quality):
    // 10 base + up to 20 more for a perfect score.
    const pct = total > 0 ? score / total : 0;
    const xp = await awardXp(user.id, {
      source: "quiz_completed",
      amount: 10 + Math.round(pct * 20),
      refKind: "quiz_attempt",
      refId: row.id,
    });

    revalidatePath("/study");
    return { ok: true as const, score, total, xp };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't save this attempt");
    console.error("submitQuizAttemptAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

export type QuizAttemptSummary = { id: string; score: number; total: number; completedAt: Date };

/** Past attempts for one quiz, most recent first — the retake history view. */
export async function fetchQuizAttemptsAction(quizId: string): Promise<QuizAttemptSummary[]> {
  const { user } = await requireUser();
  return db
    .select({ id: quizAttempts.id, score: quizAttempts.score, total: quizAttempts.total, completedAt: quizAttempts.completedAt })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.userId, user.id)))
    .orderBy(desc(quizAttempts.completedAt));
}

export async function deleteQuizAction(quizId: string) {
  const { user } = await requireUser();
  try {
    await db.delete(quizzes).where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)));
    revalidatePath("/study");
    return { ok: true as const };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't delete the quiz");
    console.error("deleteQuizAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

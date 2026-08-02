"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { quizzes, quizAttempts, directoryFlashcards, type QuizQuestion, type QuizAnswer } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateQuizBatch, QUIZ_BATCH } from "@/lib/ai/quiz";
import { aiAvailable } from "@/lib/ai/provider";
import {
  clamp,
  DEFAULT_QUIZ_COUNT,
  DEFAULT_STUDY_DIFFICULTY,
  QUIZ_COUNT_RANGE,
} from "@/lib/ai/study-options";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { awardXp } from "@/lib/gamify/award";
import { quizXp } from "@/lib/gamify/rules";
import { dbErrorMessage } from "@/lib/db/errors";
import { fetchDirectoryPage } from "@/lib/directory/query";
import { getUserSettings } from "@/lib/settings/store";

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

/**
 * Quiz generation is STAGGERED: one model call per request.
 *
 * A quiz is several batches of questions, and this deploys to Netlify, where a
 * function is killed at ~10s no matter what `maxDuration` says (that export is
 * Vercel-only). Looping over batches inside a single action therefore ran a
 * race it could not win — the request died part-way, and because a killed
 * function returns an HTML error page rather than an RSC payload, the user saw
 * Next's generic "An unexpected response was received from the server" with no
 * hint that a timeout caused it.
 *
 * So `generateQuizAction` creates the quiz and writes the FIRST batch, and
 * `continueQuizAction` adds one batch per call until the quiz is full. The
 * client drives that loop and shows progress, exactly like the Daily Brief
 * fills itself section by section. Each request is one short model call, a
 * severed request costs only its own batch, and the quiz is openable from the
 * first batch onward instead of being all-or-nothing.
 */

/** Shared shape for both generation steps, so the client can drive one loop. */
export type QuizProgress = {
  ok: true;
  id: string;
  /** Questions written so far. */
  count: number;
  /** Questions the finished quiz will have. */
  total: number;
  /** No further `continueQuizAction` call is needed. */
  done: boolean;
  /** This round added nothing usable. Not fatal — see `continueQuizAction`. */
  stalled?: boolean;
  xp?: Awaited<ReturnType<typeof awardXp>>;
};
export type QuizStepResult = QuizProgress | { ok: false; error: string };

/** Resolve the stored source items back into text for a batch. Kept out of the
 *  quiz row: the text can be hundreds of KB, and it is already on disk. */
async function loadSources(userId: string, itemIds: string[]) {
  const resolved = await Promise.all(itemIds.map((id) => getDirectoryItemStudyText(userId, id)));
  return resolved
    .map((r) => (r ? { title: r.title, text: r.text } : null))
    .filter((s): s is { title: string; text: string } => s !== null);
}

/** How many questions this user's quizzes should have. */
async function quizPrefs(userId: string) {
  const settings = await getUserSettings(userId);
  return {
    total: clamp(
      settings.quizCount ?? DEFAULT_QUIZ_COUNT,
      QUIZ_COUNT_RANGE.min,
      QUIZ_COUNT_RANGE.max,
    ),
    difficulty: settings.quizDifficulty ?? DEFAULT_STUDY_DIFFICULTY,
  };
}

/** Step 1: create the quiz from one or more Directory items and write its
 *  first batch of questions. */
export async function generateQuizAction(itemIds: string[]): Promise<QuizStepResult> {
  const ids = [...new Set(itemIds)].filter(Boolean).slice(0, MAX_ITEMS_PER_QUIZ);
  if (ids.length === 0) return { ok: false as const, error: "Select at least one document" };
  const { user } = await requireUser();

  try {
    const resolved = await Promise.all(ids.map((id) => getDirectoryItemStudyText(user.id, id)));
    const sources = resolved
      .map((r, i) => (r ? { title: r.title, text: r.text, itemId: ids[i] } : null))
      .filter((s): s is { title: string; text: string; itemId: string } => s !== null);
    if (sources.length === 0) return { ok: false as const, error: "None of the selected items were found" };

    const { total, difficulty } = await quizPrefs(user.id);
    const { questions, error: genError } = await generateQuizBatch(
      sources.map(({ title, text }) => ({ title, text })),
      { want: Math.min(QUIZ_BATCH, total), difficulty },
    );
    if (questions.length === 0) {
      // Distinguish WHY generation came back empty, same reasoning as flashcards.
      if (!sources.some((s) => s.text.trim()))
        return { ok: false as const, error: "These items have no text yet to quiz on" };
      if (!aiAvailable())
        return { ok: false as const, error: "AI isn't configured — add an API key in Settings" };
      // The generator's own reason when it has one. Previously this was logged
      // server-side and the user got a generic "try again" for every distinct
      // cause — rate limit, bad schema, timeout — which made it impossible to
      // tell a transient failure from a permanent one.
      return {
        ok: false as const,
        error: genError
          ? `Couldn't generate a quiz: ${genError}`
          : "Couldn't generate a quiz from this text — try again",
      };
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
    // Awarded once, on creation — later batches extend the same quiz.
    const xp = await awardXp(user.id, {
      source: "quiz_made",
      itemId: sources.length === 1 ? sources[0].itemId : null,
      refKind: "quiz_made",
      refId: row.id,
    });

    revalidatePath("/study");
    return {
      ok: true as const,
      id: row.id,
      count: withIds.length,
      total,
      done: withIds.length >= total,
      xp,
    };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't create the quiz");
    console.error("generateQuizAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/**
 * Step 2..n: add one more batch to a quiz that isn't full yet.
 *
 * Appends rather than replaces, and re-reads the row each call, so two
 * overlapping drives can't lose each other's questions. A batch that comes
 * back empty ends the loop with `done: true` rather than erroring — the
 * questions already written are a usable quiz, which is the whole point of
 * generating them a few at a time.
 */
export async function continueQuizAction(quizId: string): Promise<QuizStepResult> {
  const { user } = await requireUser();
  try {
    const [row] = await db
      .select({ id: quizzes.id, itemIds: quizzes.itemIds, questions: quizzes.questions })
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)))
      .limit(1);
    if (!row) return { ok: false as const, error: "Quiz not found" };

    const { total, difficulty } = await quizPrefs(user.id);
    const have = row.questions.length;
    if (have >= total) {
      return { ok: true as const, id: row.id, count: have, total, done: true };
    }

    const sources = await loadSources(user.id, row.itemIds);
    if (sources.length === 0) {
      return { ok: true as const, id: row.id, count: have, total, done: true };
    }

    const { questions } = await generateQuizBatch(sources, {
      want: Math.min(QUIZ_BATCH, total - have),
      difficulty,
      existing: row.questions.map((q) => q.question),
    });
    if (questions.length === 0) {
      // Nothing usable THIS round — which is not the same as nothing more being
      // possible. A batch routinely under-delivers: the model repeats a question
      // it was told not to, or emits four options that aren't distinct, and
      // `normalizeQuestion` drops them. Declaring the quiz finished here meant a
      // single bad batch capped it permanently — asking for 10 and getting 7.
      // Report the stall instead and let the caller decide whether to try again.
      return { ok: true as const, id: row.id, count: have, total, done: have >= total, stalled: true };
    }

    const merged: QuizQuestion[] = [
      ...row.questions,
      ...questions.map((q) => ({ ...q, id: randomUUID() })),
    ].slice(0, total);
    await db
      .update(quizzes)
      .set({ questions: merged, updatedAt: new Date() })
      .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)));

    revalidatePath("/study");
    return {
      ok: true as const,
      id: row.id,
      count: merged.length,
      total,
      done: merged.length >= total,
    };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't add more questions");
    console.error("continueQuizAction failed:", msg);
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

export type QuizForTaking = { id: string; title: string; questions: QuizQuestion[]; itemIds: string[] };

/** One quiz's full question set, for taking/retaking it. */
export async function fetchQuizAction(quizId: string): Promise<QuizForTaking | null> {
  const { user } = await requireUser();
  const [row] = await db
    .select({ id: quizzes.id, title: quizzes.title, questions: quizzes.questions, itemIds: quizzes.itemIds })
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

    // Strongly score-scaled: a quiz is marked against the right answer, unlike
    // a self-reported card grade, so what you actually got right decides most
    // of the reward. See quizXp.
    const xp = await awardXp(user.id, {
      source: "quiz_completed",
      amount: quizXp(score, total),
      refKind: "quiz_attempt",
      refId: row.id,
    });

    revalidatePath("/study");
    return { ok: true as const, attemptId: row.id, score, total, xp };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't save this attempt");
    console.error("submitQuizAttemptAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Add the questions missed on one attempt to the flashcard deck, so they get
 *  spaced-repetition drilling instead of just a one-time score. Re-derives the
 *  miss set from the stored attempt server-side (not from client-supplied
 *  text) so the cards always match what was actually graded. */
export async function addMissedToFlashcardsAction(quizId: string, attemptId: string) {
  const { user } = await requireUser();

  try {
    const [quiz] = await db
      .select({ questions: quizzes.questions, itemIds: quizzes.itemIds })
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)))
      .limit(1);
    if (!quiz) return { ok: false as const, error: "Quiz not found" };

    const [attempt] = await db
      .select({ answers: quizAttempts.answers })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.id, attemptId),
          eq(quizAttempts.quizId, quizId),
          eq(quizAttempts.userId, user.id),
        ),
      )
      .limit(1);
    if (!attempt) return { ok: false as const, error: "Attempt not found" };

    const answerById = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const missed = quiz.questions.filter((q) => {
      const a = answerById.get(q.id);
      if (!a) return true; // unanswered counts as missed
      if (q.type === "mc" && a.type === "mc") return a.selectedIndex !== q.correctIndex;
      if (q.type === "open" && a.type === "open") return !a.selfCorrect;
      return true;
    });
    if (missed.length === 0) return { ok: false as const, error: "Nothing missed on this attempt" };

    const cards = missed.map((q) => ({
      userId: user.id,
      itemId: quiz.itemIds.length === 1 ? quiz.itemIds[0] : null,
      question: q.question,
      answer:
        q.type === "mc"
          ? q.explanation
            ? `${q.options[q.correctIndex]} — ${q.explanation}`
            : q.options[q.correctIndex]
          : q.answer,
    }));
    await db.insert(directoryFlashcards).values(cards);

    // Gamify: same tier as making flashcards any other way. Idempotent per
    // attempt so re-adding from the same score screen can't double-earn.
    const xp = await awardXp(user.id, {
      source: "cards_made",
      itemId: cards.length === 1 ? cards[0].itemId : null,
      refKind: "quiz_missed_cards",
      refId: attemptId,
    });

    revalidatePath("/study");
    return { ok: true as const, count: cards.length, xp };
  } catch (err) {
    const msg = dbErrorMessage(err, "Couldn't add cards");
    console.error("addMissedToFlashcardsAction failed:", msg);
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

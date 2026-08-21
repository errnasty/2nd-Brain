import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quizzes } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, budgetExceededMessage } from "@/lib/ai/budget";
import { gradeOpenAnswer } from "@/lib/ai/grade-open";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * POST /api/study/grade-open — mark a written answer against a quiz question.
 *
 * The question and its reference answer are read from the STORED quiz rather
 * than taken from the request. A client that could post its own reference
 * answer could have any text graded against any other text at our expense,
 * and the quiz row is the authority on what was actually asked anyway.
 *
 * Returns 200 with `{ grade: null }` when grading is unavailable or fails —
 * the caller falls back to plain self-grading, which is always available.
 */
export async function POST(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const rl = await checkRateLimit(user.id, "grade-open", 60, 60);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const budget = await checkAiBudget(user.id);
  if (!budget.allowed) {
    return NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    quizId?: unknown;
    questionId?: unknown;
    answer?: unknown;
  };
  if (typeof body.quizId !== "string" || typeof body.questionId !== "string") {
    return NextResponse.json({ error: "Missing quiz or question" }, { status: 400 });
  }
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!answer) return NextResponse.json({ error: "Nothing to grade" }, { status: 400 });

  const [row] = await db
    .select({ questions: quizzes.questions })
    .from(quizzes)
    .where(and(eq(quizzes.id, body.quizId), eq(quizzes.userId, user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const question = row.questions.find((q) => q.id === body.questionId);
  if (!question || question.type !== "open") {
    return NextResponse.json({ error: "Not an open question" }, { status: 400 });
  }

  const grade = await gradeOpenAnswer({
    question: question.question,
    modelAnswer: question.answer,
    userAnswer: answer,
  });

  return NextResponse.json({ grade });
}

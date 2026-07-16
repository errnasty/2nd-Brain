import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel, smartModel } from "./provider";

// Cloud (Netlify) must finish inside the ~10s serverless limit → fast model,
// bounded output (mirrors study-plan.ts). Desktop runs the server locally with
// no such limit, and a quiz can span several documents, so it gets the
// stronger model + a bigger budget.
const isDesktop = process.env.APP_RUNTIME === "desktop";
const MAX_OUTPUT_TOKENS = isDesktop ? 6000 : 3000;

const QuizQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mc"),
    question: z.string().min(3).max(300),
    options: z.array(z.string().min(1).max(200)).length(4),
    correctIndex: z.number().int().min(0).max(3),
  }),
  z.object({
    type: z.literal("open"),
    question: z.string().min(3).max(300),
    answer: z.string().min(1).max(800),
  }),
]);

const QuizSchema = z.object({
  questions: z.array(QuizQuestionSchema).min(4).max(12),
});

export type GeneratedQuizQuestion = z.infer<typeof QuizQuestionSchema>;

/**
 * Generate a mixed multiple-choice / open-ended quiz from one or more
 * documents' text. One model call; returns [] on failure so the caller
 * degrades quietly (no AI configured, no usable text, or a bad generation).
 */
export async function generateQuiz(
  sources: { title: string; text: string }[],
): Promise<GeneratedQuizQuestion[]> {
  if (!aiAvailable()) return [];

  const combined = sources
    .filter((s) => s.text.trim())
    .map((s, i) => `Document ${i + 1}: ${s.title}\n${s.text.slice(0, 5000)}`)
    .join("\n\n---\n\n");
  if (!combined.trim()) return [];

  try {
    const { object } = await generateObject({
      model: isDesktop ? smartModel() : fastModel(),
      schema: QuizSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: `You create a quiz that tests understanding of the provided document(s).

Rules:
- 6-10 questions, mixing multiple-choice ("mc") and open-ended ("open") types.
- Cover the most important, durable concepts across ALL provided documents — not just the first one.
- Multiple-choice: exactly 4 options, exactly one correct, plausible distractors (never "all/none of the above").
- Open-ended: one specific, answerable prompt with a concise, correct model answer.
- Base every question ONLY on the provided text — do not invent facts.`,
      prompt: combined.slice(0, 20_000),
    });
    return object.questions;
  } catch (err) {
    console.warn("generateQuiz failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel, smartModel } from "./provider";
import {
  clamp,
  DEFAULT_QUIZ_COUNT,
  DEFAULT_STUDY_DIFFICULTY,
  QUIZ_COUNT_RANGE,
  type StudyDifficulty,
} from "./study-options";

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
    // Shown after the learner answers, whether they got it right or not —
    // the "why" is what actually builds understanding, not just the score.
    explanation: z.string().min(1).max(400),
  }),
  z.object({
    type: z.literal("open"),
    question: z.string().min(3).max(300),
    answer: z.string().min(1).max(800),
  }),
]);

export type GeneratedQuizQuestion = z.infer<typeof QuizQuestionSchema>;

const DIFFICULTY_GUIDANCE: Record<StudyDifficulty, string> = {
  easy: "Test direct recall of explicitly stated facts. MC distractors should be clearly wrong to anyone who read the text; open questions ask for one stated fact.",
  medium: "Mix recall with light inference. MC distractors should be plausible but distinguishable; open questions may require connecting two related facts.",
  hard: "Require inference, application, or synthesis across the material. MC distractors should be subtle enough to need careful reading to eliminate; open questions should require reasoning, not lookup.",
};

/**
 * Generate a mixed multiple-choice / open-ended quiz from one or more
 * documents' text. One model call; returns [] on failure so the caller
 * degrades quietly (no AI configured, no usable text, or a bad generation).
 */
export async function generateQuiz(
  sources: { title: string; text: string }[],
  opts?: { count?: number; difficulty?: StudyDifficulty },
): Promise<GeneratedQuizQuestion[]> {
  if (!aiAvailable()) return [];

  const combined = sources
    .filter((s) => s.text.trim())
    .map((s, i) => `Document ${i + 1}: ${s.title}\n${s.text.slice(0, 5000)}`)
    .join("\n\n---\n\n");
  if (!combined.trim()) return [];

  const count = clamp(opts?.count ?? DEFAULT_QUIZ_COUNT, QUIZ_COUNT_RANGE.min, QUIZ_COUNT_RANGE.max);
  const difficulty = opts?.difficulty ?? DEFAULT_STUDY_DIFFICULTY;
  const schema = z.object({
    questions: z.array(QuizQuestionSchema).min(1).max(count),
  });

  try {
    const { object } = await generateObject({
      model: isDesktop ? smartModel() : fastModel(),
      schema,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: `You create a quiz that tests understanding of the provided document(s).

Rules:
- Generate EXACTLY ${count} question${count === 1 ? "" : "s"}, mixing multiple-choice ("mc") and open-ended ("open") types.
- Difficulty: ${DIFFICULTY_GUIDANCE[difficulty]}
- Cover the most important, durable concepts across ALL provided documents — not just the first one.
- Multiple-choice: exactly 4 options, exactly one correct, plausible distractors (never "all/none of the above"); include a 1-2 sentence explanation of why the correct answer is right (and, where useful, why the tempting wrong option is wrong).
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

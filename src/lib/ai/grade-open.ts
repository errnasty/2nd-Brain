import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import { generateJson } from "./generate-json";
import { truncateText } from "./study-options";

export type OpenVerdict = "correct" | "partial" | "incorrect";
export type OpenGrade = { verdict: OpenVerdict; feedback: string };

const GradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string().min(1),
});

const MAX_FEEDBACK_CHARS = 300;
/** Guard against a pasted essay becoming an unbounded prompt. */
const MAX_USER_ANSWER_CHARS = 2_000;

/**
 * Compare a written answer against the quiz's model answer.
 *
 * ## Advice, not a verdict
 *
 * The learner still presses "Got it" or "Missed it" — this only pre-selects
 * one and explains why. That split is deliberate. Grading free text is exactly
 * the kind of judgement a model gets wrong in ways the learner can see and the
 * app cannot: a right answer in unexpected words, a right answer that is more
 * precise than the model's own, a wrong answer that reads confidently. Letting
 * it write to the score would mean arguing with your own quiz results.
 *
 * "partial" exists so the model has somewhere honest to put a half-answer
 * rather than being forced to round it to a lie in either direction. It maps
 * to "Missed it" on the self-grade, because recall that needed prompting is
 * recall that has not landed yet — the same standard the flashcard reviewer
 * uses.
 *
 * Returns null on any failure so the caller falls back to plain self-grading.
 */
export async function gradeOpenAnswer(input: {
  question: string;
  modelAnswer: string;
  userAnswer: string;
}): Promise<OpenGrade | null> {
  if (!aiAvailable()) return null;
  const userAnswer = input.userAnswer.trim();
  if (!userAnswer) return null;

  try {
    const object = await generateJson({
      model: await userFastModel(),
      schema: GradeSchema,
      system: `You mark a learner's written answer against a reference answer.

Judge whether the learner knows the fact, not whether they phrased it like the
reference. Rules:
- "correct": the substance matches, even in different words or with less detail.
- "partial": some of the substance is there, or it is right but missing a key part.
- "incorrect": the substance is wrong, or the answer says nothing specific.
- An answer MORE precise or more complete than the reference is "correct".
- Feedback: one or two sentences, addressed to the learner, naming what was
  missing or wrong. No preamble, no praise padding.`,
      prompt: `Question: ${input.question}

Reference answer: ${input.modelAnswer}

Learner's answer: ${truncateText(userAnswer, MAX_USER_ANSWER_CHARS)}`,
    });
    if (!object) return null;
    return {
      verdict: object.verdict,
      feedback: truncateText(object.feedback.trim(), MAX_FEEDBACK_CHARS),
    };
  } catch (err) {
    console.warn("gradeOpenAnswer failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

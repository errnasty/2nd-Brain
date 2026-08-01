import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel, userSmartModel } from "./user-model";
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

/**
 * The question shape the app uses. Multiple-choice and open-ended are genuinely
 * different records, so this stays a discriminated union — but it is built in
 * code from the FLAT schema below, not asked for directly.
 */
export type GeneratedQuizQuestion =
  | {
      type: "mc";
      question: string;
      options: string[];
      correctIndex: number;
      // Shown after the learner answers, whether they got it right or not —
      // the "why" is what actually builds understanding, not just the score.
      explanation: string;
    }
  | { type: "open"; question: string; answer: string };

/**
 * What we actually ask the model for: ONE object shape with optional fields.
 *
 * This used to be a `z.discriminatedUnion`, which compiles to `anyOf` in JSON
 * Schema. Structured-output modes vary a lot in how well they handle a union
 * inside an array — some providers reject the schema outright, others satisfy
 * it by emitting a shape that fails validation — and either way the whole
 * generation was discarded and the user saw "couldn't generate a quiz".
 *
 * A flat schema is boring and universally supported. The union is reconstructed
 * by `normalizeQuestion`, where a malformed question costs one question instead
 * of the entire quiz.
 */
const FlatQuestionSchema = z.object({
  type: z.enum(["mc", "open"]),
  question: z.string().min(3).max(300),
  /** mc only: exactly 4 choices. */
  options: z.array(z.string().min(1).max(200)).max(6).optional(),
  /** mc only: index into `options`. */
  correctIndex: z.number().int().min(0).max(5).optional(),
  /** mc only. */
  explanation: z.string().max(400).optional(),
  /** open only: the model answer. */
  answer: z.string().max(800).optional(),
});

type FlatQuestion = z.infer<typeof FlatQuestionSchema>;

/**
 * Turn one loosely-typed generated question into a valid one, or drop it.
 *
 * Pure and exported so the tolerance rules are testable: this is where a
 * model's near-misses are either salvaged or discarded, and it is the
 * difference between one bad question and no quiz at all.
 */
export function normalizeQuestion(raw: FlatQuestion): GeneratedQuizQuestion | null {
  const question = raw.question?.trim();
  if (!question) return null;

  if (raw.type === "mc") {
    const options = (raw.options ?? []).map((o) => o.trim()).filter(Boolean);
    // Four is the contract the UI renders. Fewer can't be shown; more would
    // mean the correct index is anyone's guess.
    if (options.length !== 4) return null;
    const correctIndex = raw.correctIndex ?? 0;
    if (correctIndex < 0 || correctIndex >= options.length) return null;
    return {
      type: "mc",
      question,
      options,
      correctIndex,
      // An explanation is genuinely useful but not worth losing a question
      // over — the score still works without it.
      explanation: raw.explanation?.trim() || "",
    };
  }

  const answer = raw.answer?.trim();
  if (!answer) return null;
  return { type: "open", question, answer };
}

const DIFFICULTY_GUIDANCE: Record<StudyDifficulty, string> = {
  easy: "Test direct recall of explicitly stated facts. MC distractors should be clearly wrong to anyone who read the text; open questions ask for one stated fact.",
  medium: "Mix recall with light inference. MC distractors should be plausible but distinguishable; open questions may require connecting two related facts.",
  hard: "Require inference, application, or synthesis across the material. MC distractors should be subtle enough to need careful reading to eliminate; open questions should require reasoning, not lookup.",
};

/** Questions requested per model call. */
export const QUIZ_BATCH = 4;

/**
 * Wall-clock budget for the whole action.
 *
 * The original code asked for all 8+ questions in one call with a 3000-token
 * ceiling. On Netlify a function is killed at ~10s regardless of `maxDuration`,
 * and 3000 tokens of quiz takes considerably longer than that to produce — so
 * the request died and the user got "couldn't generate a quiz from this text",
 * every time, no matter how good the text was.
 *
 * Now questions are generated a few at a time and the loop stops when the
 * budget is spent, returning whatever landed. A four-question quiz beats an
 * error, and on a host without the limit the full set still comes back.
 */
const GENERATION_BUDGET_MS = isDesktop ? 60_000 : 7_000;

export type QuizGeneration = {
  questions: GeneratedQuizQuestion[];
  /**
   * Why generation produced nothing. Propagated so the UI can say something
   * true instead of "try again" — the old code logged this and returned [],
   * which made every distinct failure look identical to the user.
   */
  error?: string;
};

/**
 * Generate a mixed multiple-choice / open-ended quiz from one or more
 * documents' text.
 *
 * Never throws. Returns whatever questions were produced plus, when that is
 * none, the reason.
 */
export async function generateQuiz(
  sources: { title: string; text: string }[],
  opts?: { count?: number; difficulty?: StudyDifficulty },
): Promise<QuizGeneration> {
  if (!aiAvailable()) return { questions: [] };

  const combined = sources
    .filter((s) => s.text.trim())
    .map((s, i) => `Document ${i + 1}: ${s.title}\n${s.text.slice(0, 5000)}`)
    .join("\n\n---\n\n");
  if (!combined.trim()) return { questions: [] };

  const count = clamp(opts?.count ?? DEFAULT_QUIZ_COUNT, QUIZ_COUNT_RANGE.min, QUIZ_COUNT_RANGE.max);
  const difficulty = opts?.difficulty ?? DEFAULT_STUDY_DIFFICULTY;
  const text = combined.slice(0, 20_000);

  const started = Date.now();
  const questions: GeneratedQuizQuestion[] = [];
  let lastError: string | undefined;

  while (questions.length < count) {
    // Stop before starting a batch we haven't time to finish. Checked at the
    // top so a first batch always runs — returning zero questions because the
    // clock was already spent would be the old bug in a new place.
    if (questions.length > 0 && Date.now() - started > GENERATION_BUDGET_MS) break;

    const want = Math.min(QUIZ_BATCH, count - questions.length);
    const schema = z.object({ questions: z.array(FlatQuestionSchema).min(1).max(want + 2) });

    try {
      const { object } = await generateObject({
        model: await (isDesktop ? userSmartModel() : userFastModel()),
        schema,
        // Sized to the batch, not the quiz — this is what keeps each call short.
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, 400 + want * 320),
        system: `You create quiz questions that test understanding of the provided document(s).

Rules:
- Generate EXACTLY ${want} question${want === 1 ? "" : "s"}, mixing multiple-choice ("mc") and open-ended ("open") types.
- Difficulty: ${DIFFICULTY_GUIDANCE[difficulty]}
- Cover the most important, durable concepts across ALL provided documents — not just the first one.
- For "mc": give exactly 4 options, set correctIndex to the right one, use plausible distractors (never "all/none of the above"), and include a 1-2 sentence explanation of why the correct answer is right. Leave "answer" empty.
- For "open": give a specific, answerable question and a concise correct model answer in "answer". Leave options/correctIndex/explanation empty.
- Base every question ONLY on the provided text — do not invent facts.`,
        prompt:
          questions.length === 0
            ? text
            : // Later batches see what already exists, or they cheerfully ask
              // the same thing again — the most obvious concepts are the most
              // obvious to every batch.
              `${text}\n\n---\nQuestions already written (do NOT repeat these):\n${questions
                .map((q) => `- ${q.question}`)
                .join("\n")}`,
      });

      const normalized = object.questions
        .map(normalizeQuestion)
        .filter((q): q is GeneratedQuizQuestion => q !== null);

      if (normalized.length === 0) {
        lastError = "The model returned no usable questions";
        break;
      }
      questions.push(...normalized);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Quiz generation failed";
      console.warn("generateQuiz batch failed:", lastError);
      // Keep whatever earlier batches produced — a partial quiz is still a quiz.
      break;
    }
  }

  return questions.length > 0
    ? { questions: questions.slice(0, count) }
    : { questions: [], error: lastError };
}

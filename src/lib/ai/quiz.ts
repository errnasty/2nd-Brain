import { generateObject, generateText } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { userSmartModel } from "./user-model";
import { extractJsonValues } from "./generate-json";
import {
  clamp,
  DEFAULT_QUIZ_COUNT,
  QUIZ_BATCH,
  DEFAULT_STUDY_DIFFICULTY,
  QUIZ_COUNT_RANGE,
  truncateText,
  type StudyDifficulty,
} from "./study-options";

export { QUIZ_BATCH };

// The cloud used to be held to a fast model and half the output budget so a
// batch could finish inside a ~10s serverless limit. Railway has no such limit,
// and the constraint was never about quiz quality — it was about the host. Both
// runtimes now get the stronger model and the full budget, so a cloud quiz is
// the same quiz the desktop app has always produced (mirrors study-plan.ts).
const MAX_OUTPUT_TOKENS = 6000;

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
/**
 * Length limits live in `normalizeQuestion`, NOT here.
 *
 * A `.max()` in the schema does not shorten an over-long field — it fails
 * validation, and one verbose explanation then discarded every question in the
 * batch and forced the slower text-mode fallback. The fields are bounded on the
 * way out instead, where over-length costs only the characters past the limit.
 * `min` bounds stay: a two-character question is not salvageable.
 */
const FlatQuestionSchema = z.object({
  type: z.enum(["mc", "open"]),
  question: z.string().min(3),
  /** mc only: exactly 4 choices. */
  options: z.array(z.string().min(1)).optional(),
  /** mc only: index into `options`. */
  correctIndex: z.number().int().min(0).optional(),
  /** mc only. */
  explanation: z.string().optional(),
  /** open only: the model answer. */
  answer: z.string().optional(),
});

/** Rendered ceilings, applied after generation. */
const MAX_QUESTION_CHARS = 300;
const MAX_OPTION_CHARS = 200;
const MAX_EXPLANATION_CHARS = 400;
const MAX_ANSWER_CHARS = 800;

type FlatQuestion = z.infer<typeof FlatQuestionSchema>;

/**
 * Turn one loosely-typed generated question into a valid one, or drop it.
 *
 * Pure and exported so the tolerance rules are testable: this is where a
 * model's near-misses are either salvaged or discarded, and it is the
 * difference between one bad question and no quiz at all.
 */
export function normalizeQuestion(raw: FlatQuestion): GeneratedQuizQuestion | null {
  const question = truncateText(raw.question?.trim() ?? "", MAX_QUESTION_CHARS);
  if (!question) return null;

  if (raw.type === "mc") {
    // Blank options are dropped, but the model's `correctIndex` refers to the
    // list it emitted — so the surviving options carry their ORIGINAL position
    // and the index is remapped onto them. Filtering in place was silently
    // mis-grading: ["A", "", "B", "C", "D"] with correctIndex 3 ("B") became
    // ["A","B","C","D"] where index 3 is "D", and the quiz then marked the
    // wrong answer correct with no sign anything was amiss.
    const kept: { text: string; from: number }[] = [];
    (raw.options ?? []).forEach((o, i) => {
      const text = o.trim();
      if (text) kept.push({ text, from: i });
    });
    // Four is the contract the UI renders. Fewer can't be shown; more would
    // mean the correct index is anyone's guess.
    if (kept.length !== 4) return null;
    // Budget/reasoning models sometimes cheat by repeating one distractor 4×.
    // Four genuinely DIFFERENT choices is the whole point of an MC question —
    // drop it rather than render four identical buttons.
    if (new Set(kept.map((o) => o.text.toLowerCase())).size !== 4) return null;

    // An absent correctIndex is NOT an answer of "A". Defaulting to 0 invented
    // a grading key: the question rendered normally and marked the first option
    // correct whatever the truth was. A question with no stated answer cannot
    // be graded, so it is dropped.
    if (raw.correctIndex === undefined) return null;
    const correctIndex = kept.findIndex((o) => o.from === raw.correctIndex);
    // The answer pointed at an option that was blank, or off the end.
    if (correctIndex < 0) return null;

    return {
      type: "mc",
      question,
      options: kept.map((o) => truncateText(o.text, MAX_OPTION_CHARS)),
      correctIndex,
      // An explanation is genuinely useful but not worth losing a question
      // over — the score still works without it.
      explanation: truncateText(raw.explanation?.trim() ?? "", MAX_EXPLANATION_CHARS),
    };
  }

  const answer = truncateText(raw.answer?.trim() ?? "", MAX_ANSWER_CHARS);
  if (!answer) return null;
  return { type: "open", question, answer };
}

const DIFFICULTY_GUIDANCE: Record<StudyDifficulty, string> = {
  easy: "Test direct recall of explicitly stated facts. MC distractors should be clearly wrong to anyone who read the text; open questions ask for one stated fact.",
  medium: "Mix recall with light inference. MC distractors should be plausible but distinguishable; open questions may require connecting two related facts.",
  hard: "Require inference, application, or synthesis across the material. MC distractors should be subtle enough to need careful reading to eliminate; open questions should require reasoning, not lookup.",
};

// Repeated for every MC question — the single most common quality failure on
// budget models is emitting the same choice more than once.
const MC_DISTINCT_RULE =
  'For "mc": give exactly 4 options and ensure all four are DIFFERENT, meaningful choices. Never repeat an option, never list "all of the above"/"none of the above", and never reword the same idea twice to pad the list.';

/** Pull an array of (loosely-typed) questions out of a raw model reply for the
 *  text-mode fallback. Accepts the contract shape `{"questions":[...]}` or a
 *  bare `[...]` array, and tolerates prose, reasoning chains, and code-fence
 *  wrapping around either. Of every valid JSON value in the reply, returns the
 *  first that is (or carries) a non-empty array. Individual malformed entries
 *  aren't fatal — `normalizeQuestion` drops them downstream. Exported so the
 *  tolerance rules are testable. */
export function extractQuestions(text: string): FlatQuestion[] {
  for (const value of extractJsonValues(text)) {
    const arr: unknown = Array.isArray(value)
      ? value
      : (value as { questions?: unknown })?.questions;
    if (Array.isArray(arr) && arr.length > 0) return arr as FlatQuestion[];
  }
  return [];
}

export type QuizGeneration = {
  questions: GeneratedQuizQuestion[];
  /**
   * Questions the model returned that could not be used — no stated answer,
   * options that weren't four distinct choices, an index pointing nowhere.
   *
   * Reported because the shortfall is otherwise invisible in a way that reads
   * as a bug: asking for 10 and being handed 7 looks like the setting was
   * ignored, when the model in fact produced 10 and three of them were not
   * gradeable. Saying so is the difference between a quiz that looks broken
   * and one that explains itself.
   */
  dropped?: number;
  /**
   * Why generation produced nothing. Propagated so the UI can say something
   * true instead of "try again" — the old code logged this and returned [],
   * which made every distinct failure look identical to the user.
   */
  error?: string;
};

/**
 * How much of each source, and of all of them together, the quiz writer reads.
 *
 * Raised from 5k/20k. At the old figures a quiz over three documents saw only
 * the opening of each, so questions clustered on introductions and anything
 * past the first few pages was untestable. These are still bounded rather than
 * unlimited because `combineSources` is re-sent with EVERY batch — the input
 * cost is paid once per batch, not once per quiz.
 */
const PER_SOURCE_CHARS = 10_000;
const TOTAL_SOURCE_CHARS = 40_000;

/** The prompt sources, prepared once and reused by every batch. */
function combineSources(sources: { title: string; text: string }[]): string {
  return sources
    .filter((s) => s.text.trim())
    .map((s, i) => `Document ${i + 1}: ${s.title}\n${s.text.slice(0, PER_SOURCE_CHARS)}`)
    .join("\n\n---\n\n")
    .slice(0, TOTAL_SOURCE_CHARS);
}

/**
 * Generate ONE batch of questions — a single model call.
 *
 * This is the unit of work one request commits. A full quiz is several model
 * calls; looping over them inside one HTTP request meant a severed response
 * lost everything and surfaced as "An unexpected response was received from the
 * server". Callers therefore drive one batch per request — the same shape the
 * Daily Brief and ThinkTank use — so questions land as they are written and a
 * failed batch costs only itself.
 *
 * `existing` is the questions already written for this quiz; later batches are
 * shown them so they don't cheerfully ask the same thing again — the most
 * obvious concepts are the most obvious to every batch.
 *
 * Never throws.
 */
export async function generateQuizBatch(
  sources: { title: string; text: string }[],
  opts: { want: number; difficulty?: StudyDifficulty; existing?: string[] },
): Promise<QuizGeneration> {
  if (!aiAvailable()) return { questions: [] };
  const text = combineSources(sources);
  if (!text.trim()) return { questions: [] };

  const want = clamp(opts.want, 1, QUIZ_BATCH);
  const difficulty = opts.difficulty ?? DEFAULT_STUDY_DIFFICULTY;
  const existing = opts.existing ?? [];
  const schema = z.object({ questions: z.array(FlatQuestionSchema).min(1).max(want + 2) });

  // Not every model — especially via the OpenAI-compatible OpenRouter client —
  // honors `generateObject`'s structured-output mode reliably. Some wrap the
  // JSON in prose or ``` fences, and the SDK throws "No object generated:
  // could not parse the response", which used to abort the whole quiz. So a
  // batch first tries `generateObject`; on ANY failure it is retried once as
  // plain text with a tolerant parse, so a picky model still yields a quiz.
  const system = `You create quiz questions that test understanding of the provided document(s).

Rules:
- Generate EXACTLY ${want} question${want === 1 ? "" : "s"}, mixing multiple-choice ("mc") and open-ended ("open") types.
- Difficulty: ${DIFFICULTY_GUIDANCE[difficulty]}
- Cover the most important, durable concepts across ALL provided documents — not just the first one.
- ${MC_DISTINCT_RULE}
- For "mc": set correctIndex to the right one and include a 1-2 sentence explanation of why the correct answer is right. Leave "answer" empty.
- For "open": give a specific, answerable question and a concise correct model answer in "answer". Leave options/correctIndex/explanation empty.
- Base every question ONLY on the provided text — do not invent facts.

Output ONLY a JSON object with this shape — no prose, no code fence:
{"questions":[{"type":"mc"|"open","question":string,"options":string[],"correctIndex":number,"explanation":string,"answer":string}]}`;
  const prompt =
    existing.length === 0
      ? text
      : `${text}\n\n---\nQuestions already written (do NOT repeat these):\n${existing
          .map((q) => `- ${q}`)
          .join("\n")}`;
  const model = await userSmartModel();
  // Sized to the batch, not the quiz — this is what keeps each call short.
  const maxTokens = Math.min(MAX_OUTPUT_TOKENS, 400 + want * 320);

  let flat: FlatQuestion[];
  try {
    const { object } = await generateObject({ model, schema, maxTokens, system, prompt });
    flat = object.questions;
  } catch (err) {
    const firstError = err instanceof Error ? err.message : "Quiz generation failed";
    console.warn("generateQuizBatch generateObject failed, retrying as text:", firstError);
    try {
      const { text: reply } = await generateText({
        model,
        // Give the text pass more headroom than the schema pass: reasoning
        // models spend tokens "thinking" before the JSON, and a too-tight
        // cap truncates the answer mid-object so nothing parses.
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(maxTokens, 400 + want * 500)),
        system,
        prompt,
      });
      flat = extractQuestions(reply);
      if (flat.length === 0) {
        // Keep a short trace so the next failure is diagnosable instead of a
        // mystery — the reply shape dictates whether it's truncation or a
        // model that won't emit JSON at all.
        console.warn("generateQuizBatch text fallback had no parseable JSON. reply:", reply.slice(0, 400));
        return { questions: [], error: "The model returned no parseable JSON" };
      }
    } catch (err2) {
      return { questions: [], error: err2 instanceof Error ? err2.message : "Quiz generation failed" };
    }
  }

  const normalized = flat
    .map(normalizeQuestion)
    .filter((q): q is GeneratedQuizQuestion => q !== null);
  const dropped = flat.length - normalized.length;
  return normalized.length > 0
    ? { questions: normalized, dropped }
    : { questions: [], dropped, error: "The model returned no usable questions" };
}

/**
 * Generate a whole quiz in one call, batch after batch.
 *
 * Only safe where a request can run long — the desktop build, or a host
 * without a hard function ceiling. The cloud path drives `generateQuizBatch`
 * one request at a time instead; see the note on that function.
 *
 * Never throws. Returns whatever questions were produced plus, when that is
 * none, the reason.
 */
export async function generateQuiz(
  sources: { title: string; text: string }[],
  opts?: { count?: number; difficulty?: StudyDifficulty },
): Promise<QuizGeneration> {
  if (!aiAvailable()) return { questions: [] };
  if (!combineSources(sources).trim()) return { questions: [] };

  const count = clamp(opts?.count ?? DEFAULT_QUIZ_COUNT, QUIZ_COUNT_RANGE.min, QUIZ_COUNT_RANGE.max);
  const questions: GeneratedQuizQuestion[] = [];
  let lastError: string | undefined;

  while (questions.length < count) {
    const batch = await generateQuizBatch(sources, {
      want: Math.min(QUIZ_BATCH, count - questions.length),
      difficulty: opts?.difficulty,
      existing: questions.map((q) => q.question),
    });
    if (batch.questions.length === 0) {
      // Keep whatever earlier batches produced — a partial quiz is still a quiz.
      lastError = batch.error;
      break;
    }
    questions.push(...batch.questions);
  }

  return questions.length > 0
    ? { questions: questions.slice(0, count) }
    : { questions: [], error: lastError };
}

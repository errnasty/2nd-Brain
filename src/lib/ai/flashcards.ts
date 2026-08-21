import { z } from "zod";
import { aiAvailable } from "./provider";
import { userSmartModel } from "./user-model";
import { generateJson } from "./generate-json";
import {
  clamp,
  DEFAULT_FLASHCARD_COUNT,
  DEFAULT_STUDY_DIFFICULTY,
  FLASHCARD_COUNT_RANGE,
  truncateText,
  type StudyDifficulty,
} from "./study-options";

export type GeneratedCard = { question: string; answer: string };

/** Characters of the source document the card writer actually gets to read. */
const CONTENT_CHARS = 20_000;

/** Rendered ceilings, applied after generation rather than in the schema —
 *  see `truncateText` for why a `.max()` here would be the wrong tool. */
const MAX_CARD_QUESTION_CHARS = 300;
const MAX_CARD_ANSWER_CHARS = 800;

/**
 * Drop cards that ask the same thing twice.
 *
 * A single generation regularly returns two cards with the same question in
 * different words. Duplicates are worse here than anywhere else in the app:
 * spaced repetition schedules each card independently, so a duplicated fact
 * comes back twice as often forever, and the reviewer cannot tell why.
 *
 * Compared on the question alone. Two cards asking the same thing with
 * different answers is a contradiction, not a pair worth keeping.
 */
function dedupeCards(cards: GeneratedCard[]): GeneratedCard[] {
  const seen = new Set<string>();
  const out: GeneratedCard[] = [];
  for (const card of cards) {
    const key = card.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

const DIFFICULTY_GUIDANCE: Record<StudyDifficulty, string> = {
  easy: "Test direct recall of explicitly stated facts and definitions. Keep wording straightforward and unambiguous.",
  medium: "Mix direct recall with light inference — connecting two related facts from the text.",
  hard: "Require inference, application, or synthesis across multiple parts of the text — not just lookup of one stated fact.",
};

/**
 * Generate recall flashcards from an item's text. One model call; returns []
 * on failure so the caller degrades quietly.
 */
export async function generateFlashcards(
  title: string,
  content: string,
  opts?: { count?: number; difficulty?: StudyDifficulty },
): Promise<GeneratedCard[]> {
  if (!aiAvailable()) return [];
  if (!content.trim()) return [];

  const count = clamp(opts?.count ?? DEFAULT_FLASHCARD_COUNT, FLASHCARD_COUNT_RANGE.min, FLASHCARD_COUNT_RANGE.max);
  const difficulty = opts?.difficulty ?? DEFAULT_STUDY_DIFFICULTY;
  // The ceiling is deliberately loose. Pinning the array to `.max(count)` made
  // overproduction fatal: a model asked for 10 that returned 11 failed schema
  // validation, threw, and the user got ZERO cards from a call that had in fact
  // produced eleven good ones. Extra cards are trimmed below instead — the one
  // failure mode here that costs nothing to recover from.
  const schema = z.object({
    cards: z
      .array(
        z.object({
          question: z.string().min(3),
          answer: z.string().min(1),
        }),
      )
      .min(1),
  });

  try {
    const object = await generateJson({
      model: await userSmartModel(),
      schema,
      system: `You create spaced-repetition flashcards that test understanding of a document.

Rules:
- Generate EXACTLY ${count} card${count === 1 ? "" : "s"} covering the most important, durable concepts.
- Difficulty: ${DIFFICULTY_GUIDANCE[difficulty]}
- Question: one specific, answerable prompt (not "what is this about").
- Answer: correct and complete but concise.
- Base cards ONLY on the provided text — do not invent facts.`,
      // 6000 characters is roughly two pages. On anything longer, every card
      // came from the opening of the document and the rest was never seen —
      // which is how a 40-page PDF produced ten cards about its introduction.
      // Matched to the quiz path's window now that a request has room for it.
      prompt: `Title: ${title}\n\n${content.slice(0, CONTENT_CHARS)}`,
    });
    // Trim rather than reject: see the schema note above.
    const cards = (object?.cards ?? []).map((c) => ({
      question: truncateText(c.question, MAX_CARD_QUESTION_CHARS),
      answer: truncateText(c.answer, MAX_CARD_ANSWER_CHARS),
    }));
    return dedupeCards(cards).slice(0, count);
  } catch (err) {
    console.warn("generateFlashcards failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

const RewriteSchema = z.object({
  question: z.string().min(3),
  answer: z.string().min(1),
});

/**
 * Rewrite a "leech" (repeatedly failed) card into a sharper formulation.
 * Returns null on failure so the caller degrades quietly.
 */
export async function rewriteFlashcard(
  question: string,
  answer: string,
): Promise<GeneratedCard | null> {
  if (!aiAvailable()) return null;

  try {
    const object = await generateJson({
      model: await userSmartModel(),
      schema: RewriteSchema,
      system: `You fix spaced-repetition flashcards the learner keeps failing.

Failed cards are usually too broad, test multiple facts at once, or have a
vague question. Rewrite this one so it tests EXACTLY ONE atomic fact with an
unambiguous question and a minimal answer. Keep the same underlying knowledge —
do not invent new facts.`,
      prompt: `Question: ${question}\n\nAnswer: ${answer}`,
    });
    if (!object) return null;
    return {
      question: truncateText(object.question, MAX_CARD_QUESTION_CHARS),
      answer: truncateText(object.answer, MAX_CARD_ANSWER_CHARS),
    };
  } catch (err) {
    console.warn("rewriteFlashcard failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

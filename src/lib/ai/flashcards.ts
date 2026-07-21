import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import {
  clamp,
  DEFAULT_FLASHCARD_COUNT,
  DEFAULT_STUDY_DIFFICULTY,
  FLASHCARD_COUNT_RANGE,
  type StudyDifficulty,
} from "./study-options";

export type GeneratedCard = { question: string; answer: string };

const DIFFICULTY_GUIDANCE: Record<StudyDifficulty, string> = {
  easy: "Test direct recall of explicitly stated facts and definitions. Keep wording straightforward and unambiguous.",
  medium: "Mix direct recall with light inference — connecting two related facts from the text.",
  hard: "Require inference, application, or synthesis across multiple parts of the text — not just lookup of one stated fact.",
};

/**
 * Generate recall flashcards from an item's text. One fast-model call;
 * returns [] on failure so the caller degrades quietly.
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
  const schema = z.object({
    cards: z
      .array(
        z.object({
          question: z.string().min(3).max(300),
          answer: z.string().min(1).max(800),
        }),
      )
      .min(1)
      .max(count),
  });

  try {
    const { object } = await generateObject({
      model: await userFastModel(),
      schema,
      system: `You create spaced-repetition flashcards that test understanding of a document.

Rules:
- Generate EXACTLY ${count} card${count === 1 ? "" : "s"} covering the most important, durable concepts.
- Difficulty: ${DIFFICULTY_GUIDANCE[difficulty]}
- Question: one specific, answerable prompt (not "what is this about").
- Answer: correct and complete but concise.
- Base cards ONLY on the provided text — do not invent facts.`,
      prompt: `Title: ${title}\n\n${content.slice(0, 6000)}`,
    });
    return object.cards;
  } catch (err) {
    console.warn("generateFlashcards failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

const RewriteSchema = z.object({
  question: z.string().min(3).max(300),
  answer: z.string().min(1).max(800),
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
    const { object } = await generateObject({
      model: await userFastModel(),
      schema: RewriteSchema,
      system: `You fix spaced-repetition flashcards the learner keeps failing.

Failed cards are usually too broad, test multiple facts at once, or have a
vague question. Rewrite this one so it tests EXACTLY ONE atomic fact with an
unambiguous question and a minimal answer. Keep the same underlying knowledge —
do not invent new facts.`,
      prompt: `Question: ${question}\n\nAnswer: ${answer}`,
    });
    return object;
  } catch (err) {
    console.warn("rewriteFlashcard failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

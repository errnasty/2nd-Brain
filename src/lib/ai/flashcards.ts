import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel } from "./provider";

const FlashSchema = z.object({
  cards: z
    .array(
      z.object({
        question: z.string().min(3).max(300),
        answer: z.string().min(1).max(800),
      }),
    )
    .min(1)
    .max(6),
});

export type GeneratedCard = { question: string; answer: string };

/**
 * Generate 3-5 recall flashcards from an item's text. One fast-model call;
 * returns [] on failure so the caller degrades quietly.
 */
export async function generateFlashcards(
  title: string,
  content: string,
): Promise<GeneratedCard[]> {
  if (!aiAvailable()) return [];
  if (!content.trim()) return [];

  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: FlashSchema,
      system: `You create spaced-repetition flashcards that test understanding of a document.

Rules:
- 3-5 cards covering the most important, durable concepts.
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
      model: fastModel(),
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

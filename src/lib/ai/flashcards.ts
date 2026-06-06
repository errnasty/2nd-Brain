import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const HAIKU = "claude-haiku-4-5-20251001";

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
 * Generate 3-5 recall flashcards from an item's text. One Haiku call; returns
 * [] on failure so the caller degrades quietly.
 */
export async function generateFlashcards(
  title: string,
  content: string,
): Promise<GeneratedCard[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  if (!content.trim()) return [];

  try {
    const { object } = await generateObject({
      model: anthropic(HAIKU),
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

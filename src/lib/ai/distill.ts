import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";

const DistillSchema = z.object({
  tldr: z.string().min(1).max(400),
  keyPoints: z.array(z.string().min(1).max(280)).min(1).max(7),
});

export type Distilled = { tldr: string; keyPoints: string[] };

/**
 * Distill an item into its "essence" — a one-line TL;DR plus a few key points —
 * so the future self can grasp it in seconds (Second Brain's Distill step). One
 * Haiku call; returns null on failure so the caller degrades quietly.
 */
export async function distill(title: string, content: string): Promise<Distilled | null> {
  if (!aiAvailable()) return null;
  if (!content.trim()) return null;

  try {
    const { object } = await generateObject({
      model: await userFastModel(),
      schema: DistillSchema,
      system: `You distill a document into its durable essence for fast future recall.

Rules:
- tldr: ONE sentence capturing the single most important idea.
- keyPoints: 3-5 crisp bullets of the most valuable, durable takeaways.
- Be specific and faithful to the text — never invent facts.
- No preamble, no "this document discusses…". State the substance directly.`,
      prompt: `Title: ${title}\n\n${content.slice(0, 8000)}`,
    });
    return object;
  } catch (err) {
    console.warn("distill failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

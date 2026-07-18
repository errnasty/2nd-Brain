import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, smartModel } from "./provider";
import type { ThinkTankSection } from "@/lib/db/schema";

export type GeneratedThinkTankDeck = {
  title: string;
  description: string;
  cards: {
    section: ThinkTankSection;
    title: string;
    body: string;
    /** Indices into the related-items list passed in (library grounding). */
    refIndexes: number[];
  }[];
};

const SECTION = z.enum(["prerequisites", "core", "advanced"]);

/**
 * Generate a ThinkTank deck: 9–12 bite-sized idea cards for a topic, ordered
 * prerequisites → core → advanced. `related` are the user's own library items
 * on the topic; cards cite them by index so the caller can attach real links.
 * One smart-model call (schema-validated); returns null on failure so the
 * caller degrades into a friendly error.
 */
export async function generateThinkTankDeck(
  topic: string,
  related: { title: string }[],
): Promise<GeneratedThinkTankDeck | null> {
  if (!aiAvailable()) return null;

  const schema = z.object({
    title: z.string().min(2).max(120),
    description: z.string().min(10).max(400),
    cards: z
      .array(
        z.object({
          section: SECTION,
          title: z.string().min(2).max(120),
          body: z.string().min(30).max(900),
          refIndexes: z.array(z.number().int().min(0).max(Math.max(0, related.length - 1))).max(3),
        }),
      )
      .min(8)
      .max(12),
  });

  const relatedList =
    related.length > 0
      ? related.map((r, i) => `${i}. ${r.title}`).join("\n")
      : "(none)";

  try {
    const { object } = await generateObject({
      model: smartModel(),
      schema,
      system: `You design Deepstash/Imprint-style micro-learning decks: a topic becomes 9–12 self-contained "idea cards" a curious adult can read in under a minute each.

Rules:
- Order cards prerequisites → core → advanced. 2–3 prerequisite cards (foundations a newcomer needs), 4–6 core cards (the load-bearing ideas), 2–3 advanced cards (nuance, applications, open debates).
- Card title: the big idea as a punchy headline (not a chapter name).
- Card body: ≤ 80 words of plain markdown. One idea per card, self-contained, concrete — an example or number beats an abstraction. No filler like "in this card we'll…".
- Deck title: a polished display title for the topic. Description: 1–2 sentences on what the reader will understand by the end.
- The learner's own library items are listed by index. When a card genuinely builds on one, include its index in refIndexes (max 3, often none). Never invent indexes.
- Accuracy over coverage: if the topic is niche, fewer, correct cards beat padded ones.`,
      prompt: `Topic: ${topic}\n\nLearner's related library items (by index):\n${relatedList}`,
    });
    return object;
  } catch (err) {
    console.warn("generateThinkTankDeck failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

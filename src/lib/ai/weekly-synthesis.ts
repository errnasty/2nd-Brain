import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import { generateJson } from "./generate-json";

const WeeklySynthesisSchema = z.object({
  throughLine: z.string().min(1).max(400),
  themes: z.array(z.string().min(1).max(200)).min(1).max(4),
  tensions: z.array(z.string().min(1).max(300)).max(4),
});

export type WeeklySynthesis = { throughLine: string; themes: string[]; tensions: string[] };

export type SynthesisInput = { title: string; excerpt: string | null };

/**
 * Read a week of reading as one body of work rather than a list: what connects
 * it, and where sources contradicted each other. Disagreement is where
 * understanding actually forms, so tensions are called out — but only real
 * ones. One Haiku call; returns null on failure so the caller degrades quietly.
 */
export async function weeklySynthesis(items: SynthesisInput[]): Promise<WeeklySynthesis | null> {
  if (!aiAvailable()) return null;
  if (items.length === 0) return null;

  // Titles + excerpts only. Full text across 40 articles would cost far more
  // than the result is worth, and headline-level signal is enough to name a
  // through-line.
  const corpus = items
    .map((it, i) => `[${i + 1}] ${it.title}\n${(it.excerpt ?? "").replace(/<[^>]+>/g, " ").slice(0, 500)}`)
    .join("\n\n");

  return generateJson({
    model: await userFastModel(),
    schema: WeeklySynthesisSchema,
    system: `You synthesize one week of a person's reading into what connects it.

Rules:
- throughLine: ONE sentence naming what connects the week's reading. Not a summary of each item — the thread running through them.
- themes: 2-4 recurring subjects, a few words each.
- tensions: places where the sources disagreed with each other, or where one undercuts another. Name both sides briefly.
- tensions MAY be an empty array. If the sources genuinely do not disagree, return []. Never manufacture a disagreement to fill the field.
- Stay strictly faithful to the supplied titles and excerpts. Never invent facts, claims, or sources.
- No preamble, no "this week you read…". State the substance directly.`,
    prompt: `Articles read this week:\n\n${corpus}`,
  });
}

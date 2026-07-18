import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, smartModel, activeProvider } from "./provider";
import { groundFromWeb, formatWebGround } from "./web-search";
import type { ThinkTankSection } from "@/lib/db/schema";

export type ThinkTankDetail = "brief" | "standard" | "deep";

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
  /** Model id that produced the deck (provenance/cost transparency). */
  model: string;
  /** Total tokens consumed by the generation call. */
  tokenCount: number | null;
};

const SECTION = z.enum(["prerequisites", "core", "advanced"]);

// Detail presets: drive the schema's card-count + per-card word ceiling so
// "deep" produces longer, more numerous cards (and costs more tokens) while
// "brief" stays tight.
const DETAIL_PRESETS: Record<
  ThinkTankDetail,
  { minCards: number; maxCards: number; maxWords: number; label: string }
> = {
  brief: { minCards: 6, maxCards: 8, maxWords: 50, label: "≤50 words/card" },
  standard: { minCards: 8, maxCards: 12, maxWords: 80, label: "≤80 words/card" },
  deep: { minCards: 12, maxCards: 16, maxWords: 140, label: "≤140 words/card" },
};

/**
 * Generate a ThinkTank deck: bite-sized idea cards for a topic, ordered
 * prerequisites → core → advanced. `related` are the user's own library items
 * on the topic; cards cite them by index so the caller can attach real links.
 * `detail` controls depth (brief/standard/deep) → card count + word ceiling.
 *
 * Web grounding: before the deck call we run a provider-agnostic web search
 * (DuckDuckGo + Jina reader) and pass a compact brief (≈ a few hundred
 * tokens) as factual grounding. This works with any OpenRouter model, not
 * just Anthropic's native web_search tool. Fail-soft: no web → ungrounded.
 *
 * One smart-model call (schema-validated); returns null on failure so the
 * caller degrades into a friendly error. The returned object carries the
 * model id + total tokens so the UI can show provenance.
 */
export async function generateThinkTankDeck(
  topic: string,
  related: { title: string }[],
  detail: ThinkTankDetail = "standard",
): Promise<GeneratedThinkTankDeck | null> {
  if (!aiAvailable()) return null;

  const preset = DETAIL_PRESETS[detail];

  const schema = z.object({
    title: z.string().min(2).max(120),
    description: z.string().min(10).max(400),
    cards: z
      .array(
        z.object({
          section: SECTION,
          title: z.string().min(2).max(120),
          body: z.string().min(30).max(preset.maxWords * 6), // chars, not words
          refIndexes: z.array(z.number().int().min(0).max(Math.max(0, related.length - 1))).max(3),
        }),
      )
      .min(preset.minCards)
      .max(preset.maxCards),
  });

  // Web grounding — fail-soft: a search/reader hiccup just means we generate
  // without fresh facts. The brief is capped at ~1.8k chars so the prompt stays
  // small.
  let webBrief = "";
  try {
    const snippets = await groundFromWeb(topic);
    if (snippets.length > 0) webBrief = formatWebGround(snippets);
  } catch {
    // ungrounded deck
  }

  const relatedList =
    related.length > 0
      ? related.map((r, i) => `${i}. ${r.title}`).join("\n")
      : "(none)";

  // Resolve the concrete model id for provenance — the UI shows which model
  // generated the deck so the user understands cost/quality.
  const modelId =
    activeProvider() === "openrouter"
      ? (process.env.OPENROUTER_SMART_MODEL ?? "anthropic/claude-sonnet-4.6")
      : "claude-sonnet-4-6";

  try {
    const result = await generateObject({
      model: smartModel(),
      schema,
      system: `You design Deepstash/Imprint-style micro-learning decks: a topic becomes ${preset.minCards}-${preset.maxCards} self-contained "idea cards" a curious adult can read in under a minute each.

Rules:
- Order cards prerequisites → core → advanced. 2-3 prerequisite cards (foundations a newcomer needs), the majority as core cards (the load-bearing ideas), 2-3 advanced cards (nuance, applications, open debates).
- Card title: the big idea as a punchy headline (not a chapter name).
- Card body: ${preset.label} of plain markdown. One idea per card, self-contained, concrete — an example or number beats an abstraction. No filler like "in this card we'll…".
- Deck title: a polished display title for the topic. Description: 1-2 sentences on what the reader will understand by the end.
- The learner's own library items are listed by index. When a card genuinely builds on one, include its index in refIndexes (max 3, often none). Never invent indexes.
- Accuracy over coverage: if the topic is niche, fewer, correct cards beat padded ones.
- WEB GROUNDING (if present) is current, factual context from the internet. Use it to keep claims accurate — cite numbers, names, dates. Don't copy it verbatim; fold the fact into your own micro-card.`,
      prompt: `Topic: ${topic}\n\nLearner's related library items (by index):\n${relatedList}\n\nWeb grounding:\n${webBrief || "(no web results)"}`,
    });
    const usage = result.usage;
    const tokenCount =
      usage && (usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
        ? (usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
        : null;
    return { ...result.object, model: modelId, tokenCount };
  } catch (err) {
    console.warn("generateThinkTankDeck failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

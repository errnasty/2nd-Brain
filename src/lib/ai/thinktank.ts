import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, smartModel, activeProvider } from "./provider";
import { webAnswerOnce, type WebSource } from "./web-answer";
import { DEFAULT_CHAT_MODEL } from "./models";
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
    /** Web sources the card's facts came from (verified against actual search citations). */
    sources: WebSource[];
  }[];
  /** Model id that produced the deck (provenance/cost transparency). */
  model: string;
  /** Total tokens consumed by the generation call. */
  tokenCount: number | null;
};

const SECTION = z.enum(["prerequisites", "core", "advanced"]);

const DeckSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().min(10).max(500),
  cards: z
    .array(
      z.object({
        section: SECTION,
        title: z.string().min(2).max(160),
        body: z.string().min(20).max(1200),
        refIndexes: z.array(z.number().int().min(0)).max(3).default([]),
        sources: z
          .array(z.object({ title: z.string().min(1).max(200), url: z.string().url() }))
          .max(2)
          .default([]),
      }),
    )
    .min(5)
    .max(18),
});

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

type DetailPreset = (typeof DETAIL_PRESETS)[ThinkTankDetail];

/**
 * Output-token budget for a deck of this depth. The old fixed budgets (3500
 * for the web path, the SDK's 4096 default for generateObject) truncated the
 * JSON mid-card on standard/deep decks — schema validation then failed and
 * the whole build died as "couldn't build a deck", every retry. Words→tokens
 * ≈ ×1.5, tripled for JSON keys/quoting headroom + title/description.
 */
function outputBudget(preset: DetailPreset): number {
  return Math.min(16_000, 1_500 + preset.maxCards * preset.maxWords * 3);
}

// Shared card-writing rules — kept terse on purpose (system prompt is resent
// on every generation, so brevity here is a per-deck token saving).
const cardRules = (preset: DetailPreset) => `Card rules:
- ${preset.minCards}-${preset.maxCards} cards, ordered: prerequisites (2-3) → core (the majority) → advanced (2-3).
- title: the big idea as a punchy headline, not a chapter name.
- body: ${preset.label} of plain markdown. One self-contained, concrete idea — an example or number beats an abstraction. No filler.
- refIndexes: indexes of the learner's library items (listed in the message) a card genuinely builds on. Usually empty, max 3. Never invent indexes.
- Accuracy over coverage: fewer correct cards beat padded ones.`;

const webSystem = (preset: DetailPreset) => `You design Deepstash/Imprint-style micro-learning decks: a topic becomes ${preset.minCards}-${preset.maxCards} idea cards a curious adult can each read in under a minute.

Use web search (at most 3 searches) to verify the key facts, figures, dates, and names BEFORE writing, so every card is factual. Prefer primary or reputable sources.

${cardRules(preset)}
- sources: per card, up to 2 web sources you actually used for its facts — only URLs your searches returned. Omit when a card needed none.

Output ONLY a JSON object (no prose, no code fence) with this shape:
{"title": string, "description": string, "cards": [{"section": "prerequisites"|"core"|"advanced", "title": string, "body": string, "refIndexes": number[], "sources": [{"title": string, "url": string}]}]}
"title" is a polished display title for the topic; "description" is 1–2 sentences on what the reader will understand by the end.`;

/** First `{...}` block in a model reply, parsed; null when absent/invalid. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function relatedList(related: { title: string }[]): string {
  return related.length > 0 ? related.map((r, i) => `${i}. ${r.title}`).join("\n") : "(none)";
}

/**
 * Web-grounded path: one Anthropic call with the native web_search tool
 * (bounded: ≤3 searches, capped output tokens). The model claims per-card
 * sources; we keep only ones matching URLs/hosts the API actually cited, so a
 * hallucinated link can never reach the UI.
 */
async function generateViaWebSearch(
  topic: string,
  related: { title: string }[],
  detail: ThinkTankDetail = "standard",
): Promise<GeneratedThinkTankDeck | null> {
  const preset = DETAIL_PRESETS[detail];
  const { text, sources: cited } = await webAnswerOnce({
    model: DEFAULT_CHAT_MODEL,
    system: webSystem(preset),
    userContent: `Topic: ${topic}\n\nLearner's library items (by index):\n${relatedList(related)}`,
    maxTokens: outputBudget(preset),
  });

  const parsed = DeckSchema.safeParse(parseJsonObject(text));
  if (!parsed.success) return null;

  const citedUrls = new Set(cited.map((s) => s.url));
  const citedHosts = new Set(cited.map((s) => hostOf(s.url)).filter(Boolean));
  return {
    ...parsed.data,
    cards: parsed.data.cards.map((c) => ({
      ...c,
      sources: c.sources.filter((s) => citedUrls.has(s.url) || citedHosts.has(hostOf(s.url))),
    })),
    // webAnswerOnce doesn't surface usage, so provenance is model-only here.
    model: DEFAULT_CHAT_MODEL,
    tokenCount: null,
  };
}

/**
 * Fallback: schema-enforced generation from model knowledge (no native web
 * tool). `detail` drives card count + word ceiling via DETAIL_PRESETS.
 *
 * Web grounding: before the deck call we run a provider-agnostic web search
 * (DuckDuckGo + Jina reader) and pass a compact brief (≈ a few hundred
 * tokens) as factual grounding. This works with any OpenRouter model, not
 * just Anthropic's native web_search tool. Fail-soft: no web → ungrounded.
 */
async function generateViaObject(
  topic: string,
  related: { title: string }[],
  detail: ThinkTankDetail = "standard",
): Promise<GeneratedThinkTankDeck | null> {
  if (!aiAvailable()) return null;

  const preset = DETAIL_PRESETS[detail];

  // Validation is deliberately looser than the prompt: the prompt asks for
  // the preset's exact card range/word ceiling, but a model that comes back
  // one card short or slightly long should yield a usable deck, not a hard
  // failure the user sees as "couldn't build".
  const schema = z.object({
    title: z.string().min(2).max(160),
    description: z.string().min(10).max(500),
    cards: z
      .array(
        z.object({
          section: SECTION,
          title: z.string().min(2).max(160),
          body: z.string().min(20).max(preset.maxWords * 10), // chars, not words
          refIndexes: z.array(z.number().int().min(0).max(Math.max(0, related.length - 1))).max(3),
        }),
      )
      .min(5)
      .max(preset.maxCards + 2),
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
      maxTokens: outputBudget(preset),
      system: `You design Deepstash/Imprint-style micro-learning decks: a topic becomes ${preset.minCards}-${preset.maxCards} self-contained "idea cards" a curious adult can read in under a minute each.

Rules:
- Order cards prerequisites → core → advanced. 2-3 prerequisite cards (foundations a newcomer needs), the majority as core cards (the load-bearing ideas), 2-3 advanced cards (nuance, applications, open debates).
- Card title: the big idea as a punchy headline (not a chapter name).
- Card body: ${preset.label} of plain markdown. One idea per card, self-contained, concrete — an example or number beats an abstraction. No filler like "in this card we'll…".
- Deck title: a polished display title for the topic. Description: 1-2 sentences on what the reader will understand by the end.
- The learner's own library items are listed by index. When a card genuinely builds on one, include its index in refIndexes (max 3, often none). Never invent indexes.
- Accuracy over coverage: if the topic is niche, fewer, correct cards beat padded ones.
- WEB GROUNDING (if present) is current, factual context from the internet. Use it to keep claims accurate — cite numbers, names, dates. Don't copy it verbatim; fold the fact into your own micro-card.`,
      prompt: `Topic: ${topic}\n\nLearner's related library items (by index):\n${relatedList(related)}\n\nWeb grounding:\n${webBrief || "(no web results)"}`,
    });
    const usage = result.usage;
    const tokenCount =
      usage && (usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
        ? (usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
        : null;
    return {
      ...result.object,
      cards: result.object.cards.map((c) => ({ ...c, sources: [] })),
      model: modelId,
      tokenCount,
    };
  } catch (err) {
    console.warn("generateViaObject failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Generate a ThinkTank deck for a topic. Prefers the web-grounded path (facts
 * verified via search, real citations); falls back to schema-enforced
 * generation when web search is unavailable or returns malformed JSON.
 * `detail` controls depth (brief/standard/deep) → card count + word ceiling.
 * Returns null on total failure so the caller degrades into a retryable error.
 */
export async function generateThinkTankDeck(
  topic: string,
  related: { title: string }[],
  detail: ThinkTankDetail = "standard",
): Promise<GeneratedThinkTankDeck | null> {
  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) return null;

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const deck = await generateViaWebSearch(topic, related, detail);
      if (deck) return deck;
    } catch (err) {
      console.warn("generateViaWebSearch failed:", err instanceof Error ? err.message : err);
    }
  }
  return generateViaObject(topic, related, detail);
}

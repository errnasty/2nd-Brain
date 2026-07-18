import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, smartModel } from "./provider";
import { webAnswerOnce, type WebSource } from "./web-answer";
import { DEFAULT_CHAT_MODEL } from "./models";
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
    /** Web sources the card's facts came from (verified against actual search citations). */
    sources: WebSource[];
  }[];
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
    .max(14),
});

// Shared card-writing rules — kept terse on purpose (system prompt is resent
// on every generation, so brevity here is a per-deck token saving).
const CARD_RULES = `Card rules:
- Order: prerequisites (2-3 cards) → core (4-6) → advanced (2-3).
- title: the big idea as a punchy headline, not a chapter name.
- body: ≤80 words of plain markdown. One self-contained, concrete idea — an example or number beats an abstraction. No filler.
- refIndexes: indexes of the learner's library items (listed in the message) a card genuinely builds on. Usually empty, max 3. Never invent indexes.
- Accuracy over coverage: fewer correct cards beat padded ones.`;

const WEB_SYSTEM = `You design Deepstash/Imprint-style micro-learning decks: a topic becomes 9–12 idea cards a curious adult can each read in under a minute.

Use web search (at most 3 searches) to verify the key facts, figures, dates, and names BEFORE writing, so every card is factual. Prefer primary or reputable sources.

${CARD_RULES}
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
): Promise<GeneratedThinkTankDeck | null> {
  const { text, sources: cited } = await webAnswerOnce({
    model: DEFAULT_CHAT_MODEL,
    system: WEB_SYSTEM,
    userContent: `Topic: ${topic}\n\nLearner's library items (by index):\n${relatedList(related)}`,
    maxTokens: 3500,
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
  };
}

/** Fallback: schema-enforced generation from model knowledge (no web). */
async function generateViaObject(
  topic: string,
  related: { title: string }[],
): Promise<GeneratedThinkTankDeck | null> {
  try {
    const { object } = await generateObject({
      model: smartModel(),
      schema: DeckSchema,
      system: `You design Deepstash/Imprint-style micro-learning decks: a topic becomes 9–12 idea cards a curious adult can each read in under a minute.\n\n${CARD_RULES}\n- sources: leave empty (no web access in this mode).\n- Deck title: a polished display title. Description: 1–2 sentences on what the reader will understand by the end.`,
      prompt: `Topic: ${topic}\n\nLearner's library items (by index):\n${relatedList(related)}`,
    });
    return { ...object, cards: object.cards.map((c) => ({ ...c, sources: [] })) };
  } catch (err) {
    console.warn("generateViaObject failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Generate a ThinkTank deck for a topic. Prefers the web-grounded path (facts
 * verified via search, real citations); falls back to schema-enforced
 * generation when web search is unavailable or returns malformed JSON.
 * Returns null on total failure so the caller degrades into a retryable error.
 */
export async function generateThinkTankDeck(
  topic: string,
  related: { title: string }[],
): Promise<GeneratedThinkTankDeck | null> {
  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) return null;

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const deck = await generateViaWebSearch(topic, related);
      if (deck) return deck;
    } catch (err) {
      console.warn("generateViaWebSearch failed:", err instanceof Error ? err.message : err);
    }
  }
  return generateViaObject(topic, related);
}

import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

/**
 * Single switch for which provider backs the app's internal AI calls
 * (tagging, flashcards, takeaways, study plans, …).
 *
 * - `OPENROUTER_API_KEY` set → OpenRouter (one key, any model, usually
 *   cheaper). Override models with `OPENROUTER_FAST_MODEL` /
 *   `OPENROUTER_SMART_MODEL` (any slug from openrouter.ai/models).
 * - Otherwise → Anthropic direct via `ANTHROPIC_API_KEY` (existing behavior).
 * - Force a provider with `AI_PROVIDER=anthropic|openrouter`.
 *
 * The Ask tab's user-facing model picker resolves separately (models.ts +
 * api/ask); this module covers the background/feature calls that previously
 * hard-coded `anthropic(HAIKU)`.
 */

const ANTHROPIC_FAST = "claude-haiku-4-5-20251001";
const ANTHROPIC_SMART = "claude-sonnet-4-6";
const OPENROUTER_FAST_DEFAULT = "anthropic/claude-haiku-4.5";
const OPENROUTER_SMART_DEFAULT = "anthropic/claude-sonnet-4.6";

export function openrouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

function activeProvider(): "openrouter" | "anthropic" {
  const forced = process.env.AI_PROVIDER;
  if (forced === "anthropic") return "anthropic";
  if (forced === "openrouter") return "openrouter";
  return openrouterKey() ? "openrouter" : "anthropic";
}

/** True when SOME provider key is configured — replaces the scattered
 *  `if (!process.env.ANTHROPIC_API_KEY) return …` fail-soft checks. */
export function aiAvailable(): boolean {
  return activeProvider() === "openrouter"
    ? !!openrouterKey()
    : !!process.env.ANTHROPIC_API_KEY;
}

/** OpenRouter speaks the OpenAI wire protocol; one client, every model. */
export function openrouterClient() {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: openrouterKey() ?? "",
    headers: { "X-Title": "Second Brain" },
  });
}

/** Cheap/fast model for high-volume background work (tagging, cards, distill). */
export function fastModel(): LanguageModelV1 {
  if (activeProvider() === "openrouter") {
    return openrouterClient()(process.env.OPENROUTER_FAST_MODEL ?? OPENROUTER_FAST_DEFAULT);
  }
  return anthropic(ANTHROPIC_FAST);
}

/** Stronger model for long-form synthesis (study plans, curricula). */
export function smartModel(): LanguageModelV1 {
  if (activeProvider() === "openrouter") {
    return openrouterClient()(process.env.OPENROUTER_SMART_MODEL ?? OPENROUTER_SMART_DEFAULT);
  }
  return anthropic(ANTHROPIC_SMART);
}

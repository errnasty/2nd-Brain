import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
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

export function activeProvider(): "openrouter" | "anthropic" {
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

// The OpenAI-compatible client is stateless given its config — building a
// fresh one on every fastModel()/smartModel() call (i.e. every AI generation)
// is needless allocation + connection-setup churn. Build it once per process
// and reuse. The API key comes from env at module load; if the operator
// rotates it at runtime, a process restart picks it up (same as the SDK's
// own behavior — the client reads the key lazily per request anyway).
let openrouterClientSingleton: ReturnType<typeof createOpenAI> | null = null;
/** OpenRouter speaks the OpenAI wire protocol; one client, every model. */
export function openrouterClient() {
  if (!openrouterClientSingleton) {
    openrouterClientSingleton = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: openrouterKey() ?? "",
      headers: { "X-Title": "Second Brain" },
    });
  }
  return openrouterClientSingleton;
}

let openrouterThinkingClientSingleton: ReturnType<typeof createOpenRouter> | null = null;
/**
 * OpenRouter via the dedicated `@openrouter/ai-sdk-provider` client (not the
 * OpenAI-compatible one above). Needed specifically for reasoning: the
 * OpenAI-compatible client can't carry OpenRouter's `reasoning` request field
 * or parse the `delta.reasoning` chunks it streams back, so it's used only
 * when the Ask/Agent routes want thinking on a `THINKING_CAPABLE_OPENROUTER`
 * model (see `models.ts`).
 */
export function openrouterThinkingClient() {
  if (!openrouterThinkingClientSingleton) {
    openrouterThinkingClientSingleton = createOpenRouter({
      apiKey: openrouterKey() ?? "",
      headers: { "X-Title": "Second Brain" },
    });
  }
  return openrouterThinkingClientSingleton;
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

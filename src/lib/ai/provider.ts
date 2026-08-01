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
// Most recent / best-value OpenRouter defaults. DeepSeek V4 Flash is cheap and
// fast and — unlike some reasoning-tagged routes — emits clean JSON, which is
// why background features (quizzes, flashcards, tagging) rely on it by default.
// Override any time with OPENROUTER_FAST_MODEL / OPENROUTER_SMART_MODEL.
const OPENROUTER_FAST_DEFAULT = "deepseek/deepseek-v4-flash-0731";
const OPENROUTER_SMART_DEFAULT = "deepseek/deepseek-v4-flash-0731";

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

let openrouterReasoningClientSingleton: ReturnType<typeof createOpenRouter> | null = null;
/**
 * OpenRouter via the dedicated `@openrouter/ai-sdk-provider` client (not the
 * OpenAI-compatible one above). It is the only client that can carry
 * OpenRouter's `reasoning` request field or parse the `delta.reasoning` chunks
 * it streams back — the OpenAI-compatible client silently drops both.
 *
 * That matters in BOTH directions, which is why this isn't named for thinking:
 *   - Ask/Agent use it to turn reasoning ON for a `THINKING_CAPABLE_OPENROUTER`
 *     model and stream the thinking to the user (see `models.ts`);
 *   - short, tightly-capped generations use it to turn reasoning OFF, so a
 *     thinking model doesn't spend the whole output budget before writing a
 *     word (see `quietReasoningOptions` in `models.ts`).
 */
export function openrouterReasoningClient() {
  if (!openrouterReasoningClientSingleton) {
    openrouterReasoningClientSingleton = createOpenRouter({
      apiKey: openrouterKey() ?? "",
      headers: { "X-Title": "Second Brain" },
    });
  }
  return openrouterReasoningClientSingleton;
}

/** Model id behind `fastModel()` — for callers that must reason about the
 *  model itself (token budgets, provenance) and not just call it. */
export function fastModelId(): string {
  return activeProvider() === "openrouter"
    ? (process.env.OPENROUTER_FAST_MODEL ?? OPENROUTER_FAST_DEFAULT)
    : ANTHROPIC_FAST;
}

/** Model id behind `smartModel()`. See `fastModelId`. */
export function smartModelId(): string {
  return activeProvider() === "openrouter"
    ? (process.env.OPENROUTER_SMART_MODEL ?? OPENROUTER_SMART_DEFAULT)
    : ANTHROPIC_SMART;
}

/** Cheap/fast model for high-volume background work (tagging, cards, distill). */
export function fastModel(): LanguageModelV1 {
  if (activeProvider() === "openrouter") return openrouterClient()(fastModelId());
  return anthropic(fastModelId());
}

/** Stronger model for long-form synthesis (study plans, curricula). */
export function smartModel(): LanguageModelV1 {
  if (activeProvider() === "openrouter") return openrouterClient()(smartModelId());
  return anthropic(smartModelId());
}

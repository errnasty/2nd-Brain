// Chat models offered in the Ask tab. Plain data so both the client selector
// and the server route can import it without pulling server-only deps.

export type ChatProvider = "anthropic" | "openai" | "openrouter";

export type ChatModel = {
  id: string;
  label: string;
  provider: ChatProvider;
  hint?: string;
};

export const CHAT_MODELS: ChatModel[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", hint: "Balanced default" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic", hint: "Fastest" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic", hint: "Most capable" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", hint: "OpenAI · value" },
  // OpenRouter: one key, many models, usually cheaper. Ids are OpenRouter
  // slugs — see openrouter.ai/models. Server rejects these with a clear
  // message when OPENROUTER_API_KEY isn't set.
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", provider: "openrouter", hint: "Fast · best value · OpenRouter" },
  { id: "anthropic/claude-sonnet-4.6", label: "Sonnet 4.6 (OpenRouter)", provider: "openrouter", hint: "Via OpenRouter" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "openrouter", hint: "Fast · OpenRouter" },
  { id: "openrouter/auto", label: "Auto (best value)", provider: "openrouter", hint: "OpenRouter routes it" },
];

export const DEFAULT_CHAT_MODEL = "claude-sonnet-4-6";

export function getChatModel(id: string | undefined): ChatModel {
  return (
    CHAT_MODELS.find((m) => m.id === id) ??
    CHAT_MODELS.find((m) => m.id === DEFAULT_CHAT_MODEL)!
  );
}

// OpenRouter slugs that reliably support tool/function calling (needed for the
// Agent's multi-step tool loop). Others via OpenRouter (e.g. DeepSeek) call
// tools inconsistently, so the agent falls back to the default model for them.
const TOOL_CAPABLE_OPENROUTER = new Set([
  "anthropic/claude-sonnet-4.6",
  "google/gemini-2.5-flash",
  "openrouter/auto",
]);

/** Whether a model can drive the Agent tool loop. Anthropic + OpenAI always;
 *  OpenRouter only for the allowlisted slugs above. */
export function isToolCapable(id: string | undefined): boolean {
  const m = getChatModel(id);
  if (m.provider === "anthropic" || m.provider === "openai") return true;
  return TOOL_CAPABLE_OPENROUTER.has(m.id);
}

// OpenRouter slugs known to support reasoning/thinking via OpenRouter's
// unified `reasoning` request field. Left off deliberately: DeepSeek V3.1 (not
// a reasoning variant) and "Auto" (backend not fixed, so support isn't
// guaranteed).
const THINKING_CAPABLE_OPENROUTER = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-flash"]);

/** Whether a model can stream extended-thinking/reasoning output. Anthropic
 *  models always; OpenRouter only for the allowlisted slugs above; OpenAI never. */
export function isThinkingCapable(id: string | undefined): boolean {
  const m = getChatModel(id);
  if (m.provider === "anthropic") return true;
  if (m.provider === "openrouter") return THINKING_CAPABLE_OPENROUTER.has(m.id);
  return false;
}

// ── Reasoning vs. a tight output budget ────────────────────────────────
//
// A reasoning model spends output tokens on a hidden thinking pass BEFORE the
// first visible character, and those tokens count against `maxTokens`. So a cap
// sized for the visible answer alone is not "a short answer" to such a model —
// it is a budget that runs out mid-thought, and generation stops with the
// answer never started. The caller gets an empty string and no error.
//
// That is exactly how the Daily Brief failed on DeepSeek V4 and other thinking
// routes: its per-section caps (300-520 tokens — a LATENCY budget, see
// `brief-prompts.ts`) were consumed entirely by reasoning, and every section
// came back blank. Which sections failed varied run to run with how long the
// model chose to think, which is why it looked intermittent.
//
// Two levers, meant to be used together: ask the model not to think
// (`quietReasoningOptions`), and budget for it thinking anyway
// (`withReasoningHeadroom`).

/**
 * Extra output tokens budgeted so a thinking pass can't consume the whole cap.
 *
 * Deliberately moderate. Generation time scales with total tokens produced,
 * hidden ones included, and the brief's sections have to finish inside the
 * host's ~10s function window — so this buys room for a short thinking pass,
 * not an unbounded one.
 */
export const REASONING_TOKEN_HEADROOM = 900;

/**
 * Whether `provider` may spend part of the output budget on hidden reasoning.
 *
 * Anthropic never thinks unless the caller explicitly enables it, so its
 * budgets are exact. Everything else here has models that think by default:
 * GPT-5 on OpenAI, and on OpenRouter both DeepSeek V4 and Gemini 2.5 Flash —
 * plus `openrouter/auto`, whose backend isn't known before the request.
 */
export function reservesReasoningTokens(provider: ChatProvider): boolean {
  return provider !== "anthropic";
}

/** `maxTokens` grown to leave room for a thinking pass on providers that have one. */
export function withReasoningHeadroom(maxTokens: number, provider: ChatProvider): number {
  return reservesReasoningTokens(provider) ? maxTokens + REASONING_TOKEN_HEADROOM : maxTokens;
}

/** Structural match for the AI SDK's provider-metadata bag, spelled out here so
 *  this module stays plain data with no `ai` import (the client imports it). */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ProviderOptions = Record<string, Record<string, JsonValue>>;

// OpenAI ids that bill reasoning against the completion budget. Scoped by id
// rather than applied to the whole provider because `reasoning_effort` is
// REJECTED outright by OpenAI's non-reasoning models — sending it blindly would
// break the very models it is meant to protect.
const OPENAI_REASONING_ID = /^(gpt-5|o[1345])/;

/**
 * Provider options asking a thinking model to skip its hidden pass, so a tight
 * `maxTokens` budget goes to the answer instead. `undefined` when the provider
 * has no such knob (Anthropic, non-reasoning OpenAI ids).
 *
 * OpenRouter honors `reasoning.enabled: false` for models whose thinking is
 * optional; models that always reason ignore it, which is what the headroom
 * above is for. Requires the dedicated OpenRouter client — the OpenAI-compatible
 * one drops the field (see `provider.ts`).
 */
export function quietReasoningOptions(
  provider: ChatProvider,
  id: string,
): ProviderOptions | undefined {
  if (provider === "openrouter") return { openrouter: { reasoning: { enabled: false } } };
  if (provider === "openai" && OPENAI_REASONING_ID.test(id)) {
    return { openai: { reasoningEffort: "minimal" } };
  }
  return undefined;
}

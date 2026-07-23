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
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", hint: "OpenAI" },
  // OpenRouter: one key, many models, usually cheaper. Ids are OpenRouter
  // slugs — see openrouter.ai/models. Server rejects these with a clear
  // message when OPENROUTER_API_KEY isn't set.
  { id: "anthropic/claude-sonnet-4.6", label: "Sonnet 4.6 (OpenRouter)", provider: "openrouter", hint: "Via OpenRouter" },
  { id: "deepseek/deepseek-chat-v3.1", label: "DeepSeek V3.1", provider: "openrouter", hint: "Cheap · OpenRouter" },
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

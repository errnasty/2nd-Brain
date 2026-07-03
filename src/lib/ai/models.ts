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

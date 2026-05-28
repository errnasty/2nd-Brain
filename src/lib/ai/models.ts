// Chat models offered in the Ask tab. Plain data so both the client selector
// and the server route can import it without pulling server-only deps.

export type ChatProvider = "anthropic" | "openai";

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
];

export const DEFAULT_CHAT_MODEL = "claude-sonnet-4-6";

export function getChatModel(id: string | undefined): ChatModel {
  return (
    CHAT_MODELS.find((m) => m.id === id) ??
    CHAT_MODELS.find((m) => m.id === DEFAULT_CHAT_MODEL)!
  );
}

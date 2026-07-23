import { streamText, type LanguageModelV1 } from "ai";
import { buildAgentTools, createSourceSink } from "./tools";
import type { AgentEvent, AgentSource } from "./stream";

const MAX_STEPS = 8;

function trim(s: unknown, n = 40): string {
  const str = typeof s === "string" ? s : "";
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** Human-readable label for a tool call, shown as a step chip in the UI. */
function labelFor(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "search_library":
      return `Searching your library${a.query ? ` · “${trim(a.query)}”` : ""}`;
    case "read_item":
      return "Reading sources";
    case "list_directory":
      return "Scanning your library";
    case "web_search":
      return `Searching the web${a.query ? ` · “${trim(a.query)}”` : ""}`;
    case "remember":
      return "Saving to memory";
    default:
      return toolName;
  }
}

export type AgentUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

/**
 * Run one Agent turn: a bounded tool-using loop (AI SDK v4
 * streamText({ tools, maxSteps })). Streams typed events (text deltas + tool
 * steps) via `onEvent`; returns the final text, accumulated citations, and
 * aggregate token usage (summed across steps).
 */
export async function runAgent({
  userId,
  model,
  system,
  question,
  history,
  onEvent,
  signal,
}: {
  userId: string;
  model: LanguageModelV1;
  system: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; sources: AgentSource[]; usage: AgentUsage }> {
  const sink = createSourceSink();
  const tools = buildAgentTools(userId, sink);

  const result = streamText({
    model,
    system,
    messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: question }],
    tools,
    maxSteps: MAX_STEPS,
    temperature: 0.3,
    abortSignal: signal,
  });

  const labels = new Map<string, string>();
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.textDelta;
      onEvent({ type: "text", delta: part.textDelta });
    } else if (part.type === "tool-call") {
      const label = labelFor(part.toolName, part.args);
      labels.set(part.toolCallId, label);
      onEvent({ type: "tool", id: part.toolCallId, label, status: "start" });
    } else if (part.type === "tool-result") {
      onEvent({
        type: "tool",
        id: part.toolCallId,
        label: labels.get(part.toolCallId) ?? part.toolName,
        status: "done",
      });
    } else if (part.type === "error") {
      onEvent({ type: "error", message: part.error instanceof Error ? part.error.message : String(part.error) });
    }
  }

  const usageRaw = await result.usage;
  const usage: AgentUsage = {
    promptTokens: usageRaw?.promptTokens ?? 0,
    completionTokens: usageRaw?.completionTokens ?? 0,
    totalTokens: usageRaw?.totalTokens ?? 0,
  };
  const sources = sink.list();
  onEvent({ type: "sources", sources });
  onEvent({ type: "usage", usage });
  return { text, sources, usage };
}

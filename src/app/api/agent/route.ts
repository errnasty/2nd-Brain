import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { requireUser } from "@/lib/auth";
import { getChatModel, isToolCapable, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { openrouterClient, openrouterKey, aiAvailable } from "@/lib/ai/provider";
import { buildDirectoryMap } from "@/lib/ai/rag";
import { memoryBlock } from "@/lib/ai/memory";
import { runAgent } from "@/lib/ai/agent/run";
import { encodeEvent } from "@/lib/ai/agent/stream";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage, budgetExceededMessage } from "@/lib/ai/budget";
import { validateAskBody } from "../ask/validate";

export const runtime = "nodejs";
// Multi-step tool loops are slower than a single answer — give them headroom.
export const maxDuration = 120;

type Message = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the user's personal Second Brain agent. You can take multiple steps using tools to answer well.

Tools:
- search_library: find relevant items in the user's own notes, articles, and documents (returns [n] citation numbers).
- read_item: read the full text of items by their [n] numbers before making claims about them.
- list_directory: see the folder/file structure (titles only).
- web_search: get current/external facts the library doesn't cover.
- remember: save a durable fact about the user for future conversations.

How to work:
- Prefer the user's own library; search it first, and read items before summarizing them.
- For questions that compare or synthesize across items, search then read the relevant ones.
- Use web_search only to fill gaps the library can't; make clear which claims came from the web.
- Cite library items inline as [1], [2], … using the numbers from search results.
- Be honest when something isn't in the library. Be concise; skip preamble.`;

/** Resolve the AI SDK model instance for an id. */
function instantiate(id: string): { model: LanguageModelV1; provider: string } {
  const m = getChatModel(id);
  if (m.provider === "openai") return { model: openai(m.id), provider: "openai" };
  if (m.provider === "openrouter") return { model: openrouterClient()(m.id), provider: "openrouter" };
  return { model: anthropic(m.id), provider: "anthropic" };
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  const rl = await checkRateLimit(userId, "agent", 15, 60);
  if (!rl.allowed) {
    return new Response("Rate limit reached — please wait a moment before running the agent again.", { status: 429 });
  }
  const budget = await checkAiBudget(userId);
  if (!budget.allowed) return new Response(budgetExceededMessage(budget), { status: 429 });
  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return new Response("No AI provider configured.", { status: 503 });
  }

  let body: { question?: string; history?: Message[]; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const validated = validateAskBody(body);
  if (!validated.ok) return new Response(validated.error, { status: validated.status });
  const question = validated.question;

  // Tool-capable model, else fall back to the default (Sonnet) and tell the UI.
  let note: string | null = null;
  let modelId = body.model ?? DEFAULT_CHAT_MODEL;
  if (!isToolCapable(modelId)) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(`${getChatModel(modelId).label} can't run the agent, and no Claude key is configured for fallback.`, { status: 503 });
    }
    note = `${getChatModel(modelId).label} can't run tools — using ${getChatModel(DEFAULT_CHAT_MODEL).label} for this.`;
    modelId = DEFAULT_CHAT_MODEL;
  }
  const { model, provider } = instantiate(modelId);
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  if (provider === "openrouter" && !openrouterKey()) return new Response("OPENROUTER_API_KEY not configured.", { status: 503 });
  if (provider === "openai" && !process.env.OPENAI_API_KEY) return new Response("OPENAI_API_KEY not configured.", { status: 503 });

  const MAX_TURN_CHARS = 4000;
  const history: Message[] = (body.history ?? [])
    .slice(-6)
    .map((m) => ({ role: m.role, content: (m.content ?? "").slice(0, MAX_TURN_CHARS) }));

  // Directory map + remembered facts give the agent a starting sense of the
  // library and the user (both fail-soft).
  const [map, memory] = await Promise.all([
    buildDirectoryMap(userId).catch(() => ""),
    memoryBlock(userId).catch(() => ""),
  ]);
  const system = `${SYSTEM}${memory}\n\nThe user's library structure:\n${map || "(unavailable)"}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          /* controller closed */
        }
      };
      try {
        if (note) send(encodeEvent({ type: "note", message: note }));
        const { usage } = await runAgent({
          userId,
          model,
          system,
          question,
          history,
          signal: req.signal,
          onEvent: (e) => send(encodeEvent(e)),
        });
        void recordAiUsage(userId, usage.totalTokens);
      } catch (err) {
        if (!req.signal.aborted) {
          send(encodeEvent({ type: "error", message: err instanceof Error ? err.message : "Agent failed" }));
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { requireUser } from "@/lib/auth";
import { getChatModel, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { openrouterClient, openrouterKey } from "@/lib/ai/provider";
import { streamWebAnswer } from "@/lib/ai/web-answer";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hard cap on the document text we feed the model, to bound token spend on
// very long articles/PDFs. ~24k chars ≈ 6k tokens of context.
const MAX_CONTENT_CHARS = 24_000;

// Mirror of the Ask route's marker (route modules can't export arbitrary
// consts). The client splits on this and never renders it.
const USAGE_SENTINEL = "<<<SB_USAGE:";

const SYSTEM = `You are the user's Second Brain assistant, answering questions
about ONE specific document the user is currently reading.

Rules:
- Answer using the DOCUMENT below as your primary, highest-priority source.
- Stay grounded in the document. If the answer isn't in it, say so plainly
  rather than inventing detail.
- Be concise and direct. Skip preamble like "Based on the document provided…".`;

const SYSTEM_WEB = `${SYSTEM}

WEB SEARCH: You also have a web_search tool. The DOCUMENT above is the priority,
higher-trust source — prefer and lead with it. Use web_search only to fill gaps
the document can't answer or to add current/external context, and make clear
which claims came from the web.`;

// Socratic tutor: quiz the user instead of answering. The document is provided
// in the system prompt (once) so multi-turn history stays cheap.
const SYSTEM_SOCRATIC = `You are a Socratic tutor examining the user on ONE document.

Behaviour:
- Do NOT lecture or answer for them. Ask ONE focused question at a time about a
  key concept in the document.
- When the user answers, briefly evaluate it: what's correct, what's missing or
  wrong. Give a short score like "3/5".
- Then ask the next question, progressing from basics to deeper understanding.
- Pinpoint weak spots and quote the short phrase from the document they should
  revisit.
- Keep each turn short. If the user says "start"/"begin" or sends nothing, open
  with your first question.`;

function resolveModel(modelId: string | undefined): { model: LanguageModelV1; provider: string } {
  const chosen = getChatModel(modelId);
  if (chosen.provider === "openai") {
    return { model: openai(chosen.id), provider: "openai" };
  }
  if (chosen.provider === "openrouter") {
    return { model: openrouterClient()(chosen.id), provider: "openrouter" };
  }
  return { model: anthropic(chosen.id), provider: "anthropic" };
}

type Turn = { role: "user" | "assistant"; content: string };
type Body = {
  title?: string;
  content?: string;
  question?: string;
  model?: string;
  web?: boolean;
  mode?: "qa" | "socratic";
  history?: Turn[];
};

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  const rl = await checkRateLimit(userId, "ask", 30, 60);
  if (!rl.allowed) {
    return new Response("Rate limit reached — please wait a moment before asking again.", {
      status: 429,
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const question = (body.question ?? "").trim();
  const title = (body.title ?? "").trim() || "Untitled";
  const content = (body.content ?? "").trim();

  const socratic = body.mode === "socratic";
  if (!socratic && !question)
    return new Response("Question is required.", { status: 400 });
  if (!content) return new Response("This document has no readable text to query.", { status: 400 });

  const { model, provider } = resolveModel(body.model);
  if (body.web) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response("ANTHROPIC_API_KEY not configured — web search needs a Claude model.", {
        status: 503,
      });
    }
  } else if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  } else if (provider === "openrouter" && !openrouterKey()) {
    return new Response("OPENROUTER_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  } else if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  }

  const truncated = content.length > MAX_CONTENT_CHARS;
  const docText = truncated ? content.slice(0, MAX_CONTENT_CHARS) + "\n…[truncated]" : content;

  const userMessage = `DOCUMENT (title: ${title}):\n"""\n${docText}\n"""\n\nQUESTION:\n${question}`;

  // Web-enabled path: Anthropic native web_search, document stays priority.
  if (body.web) {
    const chosen = getChatModel(body.model);
    const webModelId = chosen.provider === "anthropic" ? chosen.id : DEFAULT_CHAT_MODEL;
    return new Response(
      streamWebAnswer({ model: webModelId, system: SYSTEM_WEB, userContent: userMessage, signal: req.signal }),
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Socratic: doc lives in the system prompt (sent once); multi-turn history
  // keeps the quiz going cheaply. QA: single message with the doc inline.
  // Cap each turn server-side (the client posts the whole transcript).
  const MAX_TURN_CHARS = 4000;
  const history: Turn[] = (body.history ?? [])
    .slice(-8)
    .map((m) => ({ role: m.role, content: (m.content ?? "").slice(0, MAX_TURN_CHARS) }));
  const result = socratic
    ? streamText({
        model,
        system: `${SYSTEM_SOCRATIC}\n\nDOCUMENT (title: ${title}):\n"""\n${docText}\n"""`,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: question || "Begin." },
        ],
        temperature: 0.5,
        abortSignal: req.signal,
      })
    : streamText({
        model,
        system: SYSTEM,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0.3,
        abortSignal: req.signal,
      });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) {
          controller.enqueue(encoder.encode(delta));
        }
        const usage = await result.usage;
        const payload = {
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
        };
        controller.enqueue(encoder.encode(`\n${USAGE_SENTINEL}${JSON.stringify(payload)}`));
      } catch (err) {
        if (!req.signal.aborted) {
          try {
            controller.enqueue(
              encoder.encode(`\n\n_(generation error: ${err instanceof Error ? err.message : "unknown"})_`),
            );
          } catch {
            /* controller closed */
          }
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
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

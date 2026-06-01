import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { requireUser } from "@/lib/auth";
import { getChatModel } from "@/lib/ai/models";
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

function resolveModel(modelId: string | undefined): { model: LanguageModelV1; provider: string } {
  const chosen = getChatModel(modelId);
  if (chosen.provider === "openai") {
    return { model: openai(chosen.id), provider: "openai" };
  }
  return { model: anthropic(chosen.id), provider: "anthropic" };
}

type Body = {
  title?: string;
  content?: string;
  question?: string;
  model?: string;
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

  if (!question) return new Response("Question is required.", { status: 400 });
  if (!content) return new Response("This document has no readable text to query.", { status: 400 });

  const { model, provider } = resolveModel(body.model);
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  }

  const truncated = content.length > MAX_CONTENT_CHARS;
  const docText = truncated ? content.slice(0, MAX_CONTENT_CHARS) + "\n…[truncated]" : content;

  const userMessage = `DOCUMENT (title: ${title}):\n"""\n${docText}\n"""\n\nQUESTION:\n${question}`;

  const result = streamText({
    model,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.3,
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
        controller.enqueue(
          encoder.encode(`\n\n_(generation error: ${err instanceof Error ? err.message : "unknown"})_`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

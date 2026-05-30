import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { requireUser } from "@/lib/auth";
import { retrieveFromDirectory, buildDirectoryMap, type RagSource } from "@/lib/ai/rag";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";
import { getChatModel } from "@/lib/ai/models";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateAskBody, withTimeout, TimeoutError } from "./validate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fail-fast budget for the pre-stream work (vector retrieval + directory map +
// optional inline backfill). If the DB or embeddings provider stalls past this,
// we return a clean JSON 504 instead of letting the proxy kill the request
// with an HTML "Inactivity Timeout" page.
const PRESTREAM_TIMEOUT_MS = 8000;

// Marker appended after the answer text carrying token usage as JSON. The
// client splits on this and never renders it. NOT exported — Next.js route
// modules only allow specific named exports.
const USAGE_SENTINEL = "<<<SB_USAGE:";

const SYSTEM = `You are the user's personal Second Brain assistant.

You are given:
1. A DIRECTORY MAP — the folder hierarchy and item titles in the user's
   knowledge base (no content, just structure). Use it to understand WHERE
   things live and to act as a semantic router: if the answer clearly lives
   in a specific file or folder, say so and prefer that.
2. A numbered list of CONTEXT excerpts retrieved from the most relevant items.

Answer the question USING the provided context.

Rules:
- Cite supporting excerpts inline using [1], [2], … keyed to the numbered
  context list.
- You may reference the directory map to point the user to relevant files even
  if their text wasn't retrieved, but be explicit that you're inferring from
  the title/location, not the content.
- If neither the map nor the context can answer, say so plainly and suggest
  what the user could add to their library.
- Be concise. Skip preamble like "Based on the context provided…".`;

type Message = { role: "user" | "assistant"; content: string };

/** Resolve the AI SDK model instance for a requested model id. */
function resolveModel(modelId: string | undefined): { model: LanguageModelV1; provider: string } {
  const chosen = getChatModel(modelId);
  if (chosen.provider === "openai") {
    return { model: openai(chosen.id), provider: "openai" };
  }
  return { model: anthropic(chosen.id), provider: "anthropic" };
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  // Cap AI spend per user: 30 questions / minute.
  const rl = await checkRateLimit(userId, "ask", 30, 60);
  if (!rl.allowed) {
    return new Response("Rate limit reached — please wait a moment before asking again.", {
      status: 429,
    });
  }

  let body: { question?: string; history?: Message[]; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Zero-token gate: reject empty/whitespace/missing questions before any DB
  // or AI SDK work (0 tokens consumed, no stream opened).
  const validated = validateAskBody(body);
  if (!validated.ok) return new Response(validated.error, { status: validated.status });
  const question = validated.question;

  // Resolve the requested model + verify the matching provider key is present.
  const { model, provider } = resolveModel(body.model);
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  }

  // Kick off the directory map now so its queries overlap retrieval's vector
  // queries instead of running after them (≈40% fewer serial round-trips).
  const mapPromise = buildDirectoryMap(userId).catch(() => "(Directory map unavailable.)");

  // ── 1. Retrieve relevant context from the Directory ─────────────
  let sources: RagSource[] = [];
  try {
    sources = await withTimeout(retrieveFromDirectory(userId, question, 8), PRESTREAM_TIMEOUT_MS, "retrieval");
  } catch (err) {
    if (err instanceof TimeoutError) {
      return Response.json(
        { error: "The retrieval engine is taking too long. Please try again in a moment." },
        { status: 504 },
      );
    }
    const message = err instanceof Error ? err.message : "";
    // A missing column means a migration hasn't been run — backfill can't fix
    // that. Anything else (e.g. embeddings provider error) is also surfaced.
    if (/does not exist|column .* does not exist|relation .* does not exist/i.test(message)) {
      return new Response(
        "Your vector schema is missing a column. Run the migration " +
          "supabase/migrations/0005_ensure_vector_columns.sql in the Supabase SQL editor, " +
          "then POST /api/embeddings/backfill.",
        { status: 503 },
      );
    }
    return new Response(
      `Retrieval failed: ${message || "embeddings provider error"}. Check your embeddings API key.`,
      { status: 503 },
    );
  }

  // ── 1b. Auto-heal: columns exist but nothing matched. Likely the
  // embeddings just haven't been generated yet. Backfill inline (bounded),
  // then retry once. Time-boxed so a slow backfill can't hang the request.
  if (sources.length === 0) {
    try {
      const result = await withTimeout(backfillEmbeddings(userId, 60), PRESTREAM_TIMEOUT_MS, "backfill");
      if (result.articlesEmbedded + result.chunksEmbedded + result.notesEmbedded > 0) {
        sources = await withTimeout(
          retrieveFromDirectory(userId, question, 8),
          PRESTREAM_TIMEOUT_MS,
          "retrieval-retry",
        );
      }
    } catch {
      // Backfill/retry failed or timed out — fall through and let the model
      // answer from the directory map alone rather than hanging.
    }
  }

  // ── 2. Build the directory map + context block ─────────────────
  // (Started in parallel above.) Time-box so a stalled map query can't hang.
  const directoryMap = await withTimeout(mapPromise, PRESTREAM_TIMEOUT_MS, "directory-map").catch(
    () => "(Directory map unavailable.)",
  );

  const contextBlock =
    sources.length === 0
      ? "(No relevant items found in your Directory.)"
      : sources
          .map(
            (s, i) =>
              `[${i + 1}] "${s.title}" (${s.kind.replace("_", " ")})\n${s.snippet}`,
          )
          .join("\n\n");

  // Encode source map in a custom header so the client can render citations
  // separately from the streamed text. (The streamed text only contains the
  // model's answer with [N] markers.)
  const sourceMap = sources.map((s) => ({
    n: sources.indexOf(s) + 1,
    directoryItemId: s.directoryItemId,
    title: s.title,
    kind: s.kind,
    similarity: Math.round(s.similarity * 100) / 100,
  }));

  // ── 3. Build messages with history ─────────────────────────────
  const history = (body.history ?? []).slice(-6); // keep recent turns only
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `DIRECTORY MAP:\n${directoryMap}\n\nQUESTION:\n${question}\n\nCONTEXT:\n${contextBlock}`,
    },
  ];

  const result = streamText({
    model,
    system: SYSTEM,
    messages,
    temperature: 0.3,
  });

  // Stream the text, then append a usage sentinel the client strips + parses.
  // (Token usage isn't known until generation finishes, so it can't go in a
  // header that's already been sent.)
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
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-rag-sources": Buffer.from(JSON.stringify(sourceMap)).toString("base64"),
    },
  });
}

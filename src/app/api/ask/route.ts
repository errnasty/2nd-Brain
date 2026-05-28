import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { requireUser } from "@/lib/auth";
import { retrieveFromDirectory, type RagSource } from "@/lib/ai/rag";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are the user's personal Second Brain assistant.

You are given a question and a numbered list of CONTEXT excerpts drawn from
their saved articles, uploaded documents, and notes. Answer the question
USING ONLY the provided context.

Rules:
- Cite supporting excerpts inline using [1], [2], … keyed to the numbered
  context list.
- If the context does not contain enough information to answer, say so plainly
  and suggest what the user could add to their library.
- Do not invent facts beyond the context.
- Be concise. Skip preamble like "Based on the context provided…".`;

type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "ANTHROPIC_API_KEY not configured. Add it to your env vars to enable Ask.",
      { status: 503 },
    );
  }

  let body: { question?: string; history?: Message[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const question = (body.question ?? "").trim();
  if (!question) return new Response("Empty question", { status: 400 });

  // ── 1. Retrieve relevant context from the Directory ─────────────
  let sources: RagSource[] = [];
  try {
    sources = await retrieveFromDirectory(userId, question, 8);
  } catch (err) {
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
  // then retry once. This turns the common "empty library" failure into a
  // self-healing first query instead of an error screen.
  if (sources.length === 0) {
    try {
      const result = await backfillEmbeddings(userId, 150);
      if (result.articlesEmbedded + result.chunksEmbedded + result.notesEmbedded > 0) {
        sources = await retrieveFromDirectory(userId, question, 8);
      }
    } catch {
      // If backfill itself fails (e.g. no embeddings key), fall through — the
      // model will just answer "not enough info in your library".
    }
  }

  // ── 2. Build the context block ─────────────────────────────────
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
      content: `QUESTION:\n${question}\n\nCONTEXT:\n${contextBlock}`,
    },
  ];

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM,
    messages,
    temperature: 0.3,
  });

  return result.toTextStreamResponse({
    headers: {
      "x-rag-sources": Buffer.from(JSON.stringify(sourceMap)).toString("base64"),
    },
  });
}

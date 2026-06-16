import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { requireUser } from "@/lib/auth";
import {
  retrieveFromDirectory,
  buildDirectoryMap,
  fetchItemContents,
  folderScopedItemIds,
  type RagSource,
} from "@/lib/ai/rag";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";
import { getChatModel, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { streamWebAnswer } from "@/lib/ai/web-answer";
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
2. CONTEXT: <document> blocks containing the ACTUAL full text of the most
   relevant items. Read these to answer — they are the file contents, not
   previews.

Answer the question USING the provided context.

Rules:
- Cite supporting documents inline using [1], [2], … keyed to each document's
  id attribute.
- You may reference the directory map to point the user to relevant files even
  if their text wasn't retrieved, but be explicit that you're inferring from
  the title/location, not the content.
- If neither the map nor the context can answer, say so plainly and suggest
  what the user could add to their library.
- Be concise. Skip preamble like "Based on the context provided…".`;

// Web-enabled variant: same priorities, plus permission to search the web to
// fill gaps. The user's own library stays the higher-priority source.
const SYSTEM_WEB = `${SYSTEM}

WEB SEARCH: You also have a web_search tool. Treat the user's DIRECTORY context
as the priority, higher-trust source — prefer and lead with it. Use web_search
only to fill gaps the library can't answer, or to add current/external facts.
When you use web results, make clear which claims came from the web.`;

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

  let body: { question?: string; history?: Message[]; model?: string; web?: boolean };
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
  // Web search is Anthropic-native, so the web path always needs the Claude key
  // regardless of which chat model was selected.
  const { model, provider } = resolveModel(body.model);
  if (body.web) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response("ANTHROPIC_API_KEY not configured — web search needs a Claude model.", {
        status: 503,
      });
    }
  } else if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  } else if (provider === "openai" && !process.env.OPENAI_API_KEY) {
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

  // ── 2. Fetch FULL content for matched items + build the map ────
  // (Map started in parallel above.) Time-box everything so a stall can't hang.
  // Union vector hits with folder-scoped items (when the question names a
  // folder) so "summarise everything in folder X" actually gets that folder's
  // content, not just whatever ranked highest by vector similarity.
  const snippetById = new Map(sources.map((s) => [s.directoryItemId, s.snippet]));
  const simById = new Map(sources.map((s) => [s.directoryItemId, s.similarity]));

  const [directoryMap, folderIds] = await Promise.all([
    withTimeout(mapPromise, PRESTREAM_TIMEOUT_MS, "directory-map").catch(
      () => "(Directory map unavailable.)",
    ),
    withTimeout(folderScopedItemIds(userId, question, 12), PRESTREAM_TIMEOUT_MS, "folder-scope").catch(
      () => [] as string[],
    ),
  ]);

  // Structural matches (folder/title) FIRST — when the user names a note or
  // folder, that intent must win over whatever ranked highest by vector
  // similarity (often unrelated articles). Vector hits fill the remainder.
  //
  // RELEVANCE FLOOR: only vector hits at/above this cosine score become
  // context + sources. Without it every weak match (sim ~0.2) was fed to the
  // model AND listed as a source, so "all my saved articles" showed up at the
  // bottom of every answer. Structural (folder/title) hits are intentional —
  // the user named them — so they bypass the floor.
  const RELEVANCE_FLOOR = 0.35;
  const relevantVectorIds = sources
    .filter((s) => s.similarity >= RELEVANCE_FLOOR)
    .map((s) => s.directoryItemId);

  let orderedIds = Array.from(new Set([...folderIds, ...relevantVectorIds])).slice(0, 10);

  // Don't go empty-handed: if nothing cleared the floor and there were no
  // structural matches, keep the top few vector hits so we can still answer.
  if (orderedIds.length === 0 && sources.length > 0) {
    orderedIds = sources.slice(0, 4).map((s) => s.directoryItemId);
  }

  const contents = await withTimeout(
    fetchItemContents(userId, orderedIds),
    PRESTREAM_TIMEOUT_MS,
    "contents",
  ).catch(() => [] as Awaited<ReturnType<typeof fetchItemContents>>);

  // Keep the orderedIds ordering for the document list.
  const contentById = new Map(contents.map((c) => [c.directoryItemId, c]));
  const ordered = orderedIds.map((id) => contentById.get(id)).filter(Boolean) as typeof contents;

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const contextBlock =
    ordered.length === 0
      ? "(No relevant items found in your Directory.)"
      : ordered
          .map((c, i) => {
            const body = c.content && c.content.length > 0 ? c.content : snippetById.get(c.directoryItemId) ?? "";
            return `<document id="${i + 1}" title="${esc(c.title)}" path="${esc(c.path)}" kind="${c.kind}">\n${body}\n</document>`;
          })
          .join("\n\n");

  // Source map for client citations, aligned to the document ids above.
  const sourceMap = ordered.map((c, i) => ({
    n: i + 1,
    directoryItemId: c.directoryItemId,
    title: c.title,
    kind: c.kind,
    similarity: Math.round((simById.get(c.directoryItemId) ?? 0) * 100) / 100,
  }));

  // ── 3. Build messages with history ─────────────────────────────
  // Keep recent turns only AND cap each turn's size server-side — the client
  // sends the whole accumulated transcript, so without this a long conversation
  // (or a crafted request) inflates the prompt unbounded.
  const MAX_TURN_CHARS = 4000;
  const history: Message[] = (body.history ?? [])
    .slice(-6)
    .map((m) => ({ role: m.role, content: (m.content ?? "").slice(0, MAX_TURN_CHARS) }));
  const userContent = `DIRECTORY MAP:\n${directoryMap}\n\nQUESTION:\n${question}\n\nCONTEXT:\n${contextBlock}`;
  const ragHeader = Buffer.from(JSON.stringify(sourceMap)).toString("base64");

  // ── Web-enabled path ────────────────────────────────────────────
  // Anthropic native web_search. Directory context (above) stays the priority
  // source; web fills gaps. This path returns a sentinel-framed stream (answer
  // text + web sources + usage) and is isolated from the AI SDK path below.
  if (body.web) {
    const chosen = getChatModel(body.model);
    const webModelId = chosen.provider === "anthropic" ? chosen.id : DEFAULT_CHAT_MODEL;
    const webStream = streamWebAnswer({
      model: webModelId,
      system: SYSTEM_WEB,
      userContent,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      signal: req.signal,
    });
    return new Response(webStream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-rag-sources": ragHeader,
      },
    });
  }

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userContent },
  ];

  const result = streamText({
    model,
    system: SYSTEM,
    messages,
    temperature: 0.3,
    // Stop generating (and stop paying for tokens) the moment the client
    // disconnects — req.signal aborts when the browser cancels the fetch.
    abortSignal: req.signal,
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
        // On a client disconnect the stream is already gone — don't enqueue.
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
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-rag-sources": ragHeader,
    },
  });
}

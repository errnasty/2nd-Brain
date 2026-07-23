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
import { getChatModel, DEFAULT_CHAT_MODEL, isThinkingCapable } from "@/lib/ai/models";
import { openrouterClient, openrouterThinkingClient, openrouterKey } from "@/lib/ai/provider";
import { rewriteQuery } from "@/lib/ai/retrieval/rewrite";
import { rerankSources, unionByItem } from "@/lib/ai/retrieval/rerank";
import { memoryBlock } from "@/lib/ai/memory";
import { streamWebAnswer } from "@/lib/ai/web-answer";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage, budgetExceededMessage } from "@/lib/ai/budget";
import { validateAskBody, withTimeout, TimeoutError } from "./validate";
import { RAGSOURCES_SENTINEL, STATUS_SENTINEL, THINKING_SENTINEL, FRAME_END } from "@/lib/ai/stream-markers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fail-fast budget for the pre-stream retrieval work (vector retrieval +
// directory map + optional inline backfill), now run *inside* the stream —
// this only bounds how long the client waits on a RAGSOURCES/status frame
// before the answer starts, not a response-header deadline.
const PRESTREAM_TIMEOUT_MS = 8000;

// Marker appended after the answer text carrying token usage as JSON. The
// client splits on this and never renders it. NOT exported — Next.js route
// modules only allow specific named exports.
const USAGE_SENTINEL = "<<<SB_USAGE:";

/** Wrap a JSON-able payload as a self-terminated inline frame (see stream-markers.ts). */
function frame(sentinel: string, payload: unknown): string {
  return `${sentinel}${Buffer.from(JSON.stringify(payload)).toString("base64")}${FRAME_END}`;
}

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
- HONESTY ABOUT GROUNDING: if the CONTEXT doesn't actually address the question
  (weak or irrelevant matches — a GROUNDING note may flag this), say plainly
  that this doesn't appear to be in the user's library yet. You may still answer
  from general knowledge, but explicitly flag that it's NOT from their library,
  and suggest turning on Web search or adding the material. Never dress up a
  general-knowledge answer as if it came from their notes.
- Be concise. Skip preamble like "Based on the context provided…".`;

// Web-enabled variant: same priorities, plus permission to search the web to
// fill gaps. The user's own library stays the higher-priority source.
const SYSTEM_WEB = `${SYSTEM}

WEB SEARCH: You also have a web_search tool. Treat the user's DIRECTORY context
as the priority, higher-trust source — prefer and lead with it. Use web_search
only to fill gaps the library can't answer, or to add current/external facts.
When you use web results, make clear which claims came from the web.`;

type Message = { role: "user" | "assistant"; content: string };

/** Resolve the AI SDK model instance for a requested model id. `thinking`
 *  routes OpenRouter models through the dedicated client that can carry
 *  OpenRouter's `reasoning` field (see provider.ts). */
function resolveModel(modelId: string | undefined, thinking: boolean): { model: LanguageModelV1; provider: string } {
  const chosen = getChatModel(modelId);
  if (chosen.provider === "openai") {
    return { model: openai(chosen.id), provider: "openai" };
  }
  if (chosen.provider === "openrouter") {
    if (thinking && isThinkingCapable(chosen.id)) {
      return { model: openrouterThinkingClient()(chosen.id), provider: "openrouter" };
    }
    return { model: openrouterClient()(chosen.id), provider: "openrouter" };
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
  const budget = await checkAiBudget(userId);
  if (!budget.allowed) {
    return new Response(budgetExceededMessage(budget), { status: 429 });
  }

  let body: {
    question?: string;
    history?: Message[];
    model?: string;
    web?: boolean;
    contextIds?: string[];
    thinking?: boolean;
  };
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

  // "Show thinking" only applies to the non-web path (raw web-search stream
  // below doesn't go through streamText) and only on models that support it.
  const wantsThinking = !!body.thinking && !body.web && isThinkingCapable(body.model);

  // Resolve the requested model + verify the matching provider key is present.
  // Web search is Anthropic-native, so the web path always needs the Claude key
  // regardless of which chat model was selected.
  const { model, provider } = resolveModel(body.model, wantsThinking);
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

  // Recent conversation, capped — used for the query rewrite AND the prompt
  // below. The client sends the whole transcript, so keep it bounded here.
  // Drop empty-content turns (e.g. a study-plan card, which is an assistant
  // message with no text) — providers reject empty content blocks. Then trim
  // any leading assistant turn so the history starts with a user message
  // (Anthropic requires the first message to be the user).
  const MAX_TURN_CHARS = 4000;
  const history: Message[] = (body.history ?? [])
    .map((m) => ({ role: m.role, content: (m.content ?? "").slice(0, MAX_TURN_CHARS) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-6);
  while (history.length > 0 && history[0].role === "assistant") history.shift();

  // Stream the response immediately — so the connection is never silently
  // idle while retrieval runs — and do all retrieval + generation inside
  // `start()`. Sources ride an inline RAGSOURCES frame instead of a response
  // header, since the header would need to be known before any of this work
  // finishes (that header-blocking wait was the root cause of long answers
  // showing up as a client-side "network error").
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* controller closed */
        }
      };
      try {
        send(frame(STATUS_SENTINEL, { stage: "retrieving" }));

        // Kick off query-INDEPENDENT work (directory map + remembered facts) now, so
        // it overlaps the rewrite's model call and the vector queries below instead
        // of running serially after them.
        const mapPromise = buildDirectoryMap(userId).catch(() => "(Directory map unavailable.)");
        const memoryPromise = memoryBlock(userId).catch(() => "");

        // Conversational query rewrite: resolve follow-up references ("the second
        // one", "it") into a standalone, keyword-rich search query before retrieval,
        // and optionally fan out sub-queries. Fail-soft + time-boxed → raw question.
        let searchQueries = [question];
        try {
          const rw = await withTimeout(rewriteQuery(question, history), 5000, "rewrite");
          if (rw.queries.length > 0) searchQueries = rw.queries;
        } catch {
          // fall back to the raw question
        }

        // ── 1. Retrieve relevant context from the Directory ─────────────
        // Pull a wider candidate set (20) than we keep — rerank (1c) narrows it.
        let sources: RagSource[] = [];
        try {
          sources = await withTimeout(retrieveFromDirectory(userId, searchQueries[0], 20), PRESTREAM_TIMEOUT_MS, "retrieval");
        } catch (err) {
          if (err instanceof TimeoutError) {
            send("_(The retrieval engine is taking too long. Please try again in a moment.)_");
            return;
          }
          const message = err instanceof Error ? err.message : "";
          // A missing column means a migration hasn't been run — backfill can't fix
          // that. Anything else (e.g. embeddings provider error) is also surfaced.
          if (/does not exist|column .* does not exist|relation .* does not exist/i.test(message)) {
            send(
              "_(Your vector schema is missing a column. Run the migration " +
                "supabase/migrations/0005_ensure_vector_columns.sql in the Supabase SQL editor, " +
                "then POST /api/embeddings/backfill.)_",
            );
          } else {
            send(`_(Retrieval failed: ${message || "embeddings provider error"}. Check your embeddings API key.)_`);
          }
          return;
        }

        // Multi-query expansion: union in results for any sub-queries the rewrite
        // produced (dedupe by item, keep best similarity). Fail-soft.
        if (searchQueries.length > 1) {
          try {
            const extra = await withTimeout(
              Promise.all(searchQueries.slice(1).map((q) => retrieveFromDirectory(userId, q, 10))),
              PRESTREAM_TIMEOUT_MS,
              "retrieval-expand",
            );
            sources = unionByItem([sources, ...extra]);
          } catch {
            // keep the primary results
          }
        }

        // ── 1b. Auto-heal: columns exist but nothing matched. Likely the
        // embeddings just haven't been generated yet. Backfill inline (bounded),
        // then retry once. Time-boxed so a slow backfill can't hang the request.
        if (sources.length === 0) {
          try {
            const result = await withTimeout(backfillEmbeddings(userId, 60), PRESTREAM_TIMEOUT_MS, "backfill");
            if (result.articlesEmbedded + result.chunksEmbedded + result.notesEmbedded > 0) {
              sources = await withTimeout(
                retrieveFromDirectory(userId, searchQueries[0], 20),
                PRESTREAM_TIMEOUT_MS,
                "retrieval-retry",
              );
            }
          } catch {
            // Backfill/retry failed or timed out — fall through and let the model
            // answer from the directory map alone rather than hanging.
          }
        }

        // ── 1c. Rerank the candidate union by answer-relevance and keep the best,
        // so the strongest evidence leads (vector similarity alone ranks by topical
        // closeness). Fail-soft + time-boxed → falls back to similarity order.
        if (sources.length > 8) {
          try {
            sources = await withTimeout(rerankSources(question, sources, 10), 6000, "rerank");
          } catch {
            sources = sources.slice(0, 10);
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

        // #8 User-attached context: explicitly pinned items always lead and bypass
        // the relevance floor. Ownership is enforced downstream in fetchItemContents.
        const attached = Array.isArray(body.contextIds)
          ? body.contextIds.filter((id) => typeof id === "string").slice(0, 8)
          : [];
        let orderedIds = Array.from(new Set([...attached, ...folderIds, ...relevantVectorIds])).slice(0, 12);

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
                  const docBody = c.content && c.content.length > 0 ? c.content : snippetById.get(c.directoryItemId) ?? "";
                  return `<document id="${i + 1}" title="${esc(c.title)}" path="${esc(c.path)}" kind="${c.kind}">\n${docBody}\n</document>`;
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
        // Honest grounding: flag when retrieval found nothing that closely matches,
        // so the model owns up instead of dressing a general-knowledge answer as if
        // it came from the user's notes. Structural (folder/attached) matches are
        // intentional, so they count as grounded regardless of vector score.
        const bestSim = sources.reduce((m, s) => Math.max(m, s.similarity), 0);
        const weaklyGrounded =
          ordered.length === 0 || (bestSim < 0.4 && folderIds.length === 0 && attached.length === 0);
        const groundingNote = weaklyGrounded
          ? "\n\n[GROUNDING: retrieval found little in the user's library that closely matches this question — be explicit about weak grounding per the rules.]"
          : "";
        const userContent = `DIRECTORY MAP:\n${directoryMap}\n\nQUESTION:\n${question}\n\nCONTEXT:\n${contextBlock}${groundingNote}`;

        send(frame(RAGSOURCES_SENTINEL, sourceMap));

        // Remembered facts (started in parallel above) so the assistant recalls what
        // it's learned about the user across conversations. Fail-soft → "".
        const memory = await memoryPromise;

        // ── Web-enabled path ────────────────────────────────────────────
        // Anthropic native web_search. Directory context (above) stays the
        // priority source; web fills gaps. streamWebAnswer already frames its
        // own WEBSOURCES + USAGE sentinels and self-closes — just pipe its bytes.
        if (body.web) {
          const chosen = getChatModel(body.model);
          const webModelId = chosen.provider === "anthropic" ? chosen.id : DEFAULT_CHAT_MODEL;
          const webStream = streamWebAnswer({
            model: webModelId,
            system: SYSTEM_WEB + memory,
            userContent,
            history: history.map((m) => ({ role: m.role, content: m.content })),
            signal: req.signal,
          });
          const reader = webStream.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            try {
              controller.enqueue(value);
            } catch {
              /* controller closed */
            }
          }
          return;
        }

        const messages = [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: userContent },
        ];

        // Extended thinking / reasoning requires default sampling — omit
        // temperature entirely when it's on. Cast: the AI SDK types this as
        // provider-specific metadata, but both anthropic.thinking and
        // openrouter.reasoning are valid provider option shapes it accepts at
        // runtime — see provider.ts / models.ts for where these come from.
        const providerOptions = (
          wantsThinking
            ? provider === "anthropic"
              ? { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } }
              : { openrouter: { reasoning: { effort: "medium" } } }
            : undefined
        ) as Parameters<typeof streamText>[0]["providerOptions"];

        const result = streamText({
          model,
          system: SYSTEM + memory,
          messages,
          ...(wantsThinking ? {} : { temperature: 0.3 }),
          // Stop generating (and stop paying for tokens) the moment the client
          // disconnects — req.signal aborts when the browser cancels the fetch.
          abortSignal: req.signal,
          providerOptions,
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            send(part.textDelta);
          } else if (part.type === "reasoning") {
            // Payload is the raw delta string, JSON-encoded like every other
            // frame — the client JSON.parses after base64-decoding.
            send(frame(THINKING_SENTINEL, part.textDelta));
          } else if (part.type === "error") {
            send(`_(generation error: ${part.error instanceof Error ? part.error.message : String(part.error)})_`);
          }
        }
        const usage = await result.usage;
        const payload = {
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
        };
        void recordAiUsage(userId, payload.totalTokens);
        send(`\n${USAGE_SENTINEL}${JSON.stringify(payload)}`);
      } catch (err) {
        // On a client disconnect the stream is already gone — don't enqueue.
        if (!req.signal.aborted) {
          send(`\n\n_(generation error: ${err instanceof Error ? err.message : "unknown"})_`);
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

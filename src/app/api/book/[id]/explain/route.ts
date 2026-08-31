import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadBookDoc, loadChapters } from "@/lib/books/access";
import { getChatModel } from "@/lib/ai/models";
import { openrouterClient, openrouterKey } from "@/lib/ai/provider";
import { clampForEmbedding, getEmbeddingsProvider, toVectorLiteral } from "@/lib/embeddings";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage, budgetExceededMessage } from "@/lib/ai/budget";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "What does this mean?" for a passage the reader has selected.
 *
 * ## Why this is its own route rather than the Ask panel
 *
 * The question a reader has mid-page is nearly always about the sentence in
 * front of them, and it is almost never phrased — they would have to stop,
 * open a panel, retype the passage and describe their confusion, by which
 * point the thought has gone. Selecting the passage IS the question.
 *
 * ## Never past this page
 *
 * The context is drawn only from chapters at or before the one the passage is
 * in. Not because of the spoiler toggle — because of what is being asked.
 * Explaining a passage using material from thirty chapters later is a spoiler
 * by construction: the answer to "who is this?" would be their fate. So the
 * clamp here is unconditional and tighter than the book-wide one, and a reader
 * with the toggle off still cannot be spoiled by this button.
 *
 * ## What it sends
 *
 * The passage, the text either side of it in its own chapter (which is what
 * makes a pronoun resolvable), and the earlier passages in this book that are
 * semantically closest to it — that last part being how "the Consul" gets
 * explained from where he was introduced, three hundred pages ago.
 */

const MAX_PASSAGE_CHARS = 4_000;
/** How much of the chapter to read out of the database before windowing. */
const MAX_CHAPTER_SCAN_CHARS = 60_000;
/** Text kept either side of the passage. */
const CHAPTER_WINDOW_CHARS = 3_000;
const MAX_EARLIER_CHARS = 6_000;

const SYSTEM = `You explain a passage from a book to the person reading it.

You are given the passage the reader selected, the text around it, and earlier
passages from the same book that may be relevant.

Rules:
- Explain what the passage means, in plain language, in a few short paragraphs
  at most. Lead with the answer, not with throat-clearing.
- Use the earlier context to identify people, places, terms and callbacks the
  reader may have lost track of.
- NEVER use knowledge of what happens later in this book, and never speculate
  about where the story or argument is going. The reader has not read it yet.
- Outside knowledge (a historical event, a technical term, an allusion) is
  welcome where it genuinely helps, but say when you are bringing it in.
- If the passage is simply hard to parse rather than obscure, paraphrase it.
- If the reader asked a specific question, answer that question.`;

function resolveModel(modelId: string | undefined): { model: LanguageModelV1; provider: string } {
  const chosen = getChatModel(modelId);
  if (chosen.provider === "openai") return { model: openai(chosen.id), provider: "openai" };
  if (chosen.provider === "openrouter") {
    return { model: openrouterClient()(chosen.id), provider: "openrouter" };
  }
  return { model: anthropic(chosen.id), provider: "anthropic" };
}

type Body = { chapterIdx?: number; text?: string; question?: string; model?: string };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const budget = await checkAiBudget(userId);
  if (!budget.allowed) return new Response(budgetExceededMessage(budget), { status: 429 });

  const { id } = await params;
  const doc = await loadBookDoc(id, userId);
  if (!doc) return new Response("Not found", { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const passage = (body.text ?? "").trim().slice(0, MAX_PASSAGE_CHARS);
  if (!passage) return new Response("Select a passage to explain.", { status: 400 });

  const chapters = await loadChapters(id, userId);
  const chapterIdx = Number.isInteger(body.chapterIdx) ? (body.chapterIdx as number) : 0;
  const chapter = chapters.find((c) => c.idx === chapterIdx);
  const question = (body.question ?? "").trim().slice(0, 500);

  const { model, provider } = resolveModel(body.model);
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return new Response("ANTHROPIC_API_KEY not configured.", { status: 503 });
  }
  if (provider === "openrouter" && !openrouterKey()) {
    return new Response("OPENROUTER_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY not configured — pick a Claude model instead.", {
      status: 503,
    });
  }

  const [around, earlier] = await Promise.all([
    chapterWindow(id, userId, chapterIdx, passage),
    earlierContext(id, userId, chapterIdx, passage),
  ]);

  const parts = [
    `BOOK: ${doc.title}`,
    chapter?.title ? `CHAPTER: ${chapter.title}` : `CHAPTER: ${chapterIdx + 1}`,
    earlier ? `EARLIER IN THIS BOOK (may or may not be relevant):\n"""\n${earlier}\n"""` : "",
    around ? `THIS CHAPTER, AROUND THE PASSAGE:\n"""\n${around}\n"""` : "",
    `THE PASSAGE THE READER SELECTED:\n"""\n${passage}\n"""`,
    question ? `THE READER ASKS:\n${question}` : `Explain this passage.`,
  ].filter(Boolean);

  const result = streamText({
    model,
    system: SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
    temperature: 0.3,
    abortSignal: req.signal,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) controller.enqueue(encoder.encode(delta));
        const usage = await result.usage;
        void recordAiUsage(userId, usage?.totalTokens ?? 0);
      } catch (err) {
        if (!req.signal.aborted) {
          try {
            controller.enqueue(
              encoder.encode(
                `\n\n_(couldn't finish: ${err instanceof Error ? err.message : "unknown error"})_`,
              ),
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

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * The text either side of the passage in its own chapter — what makes a
 * pronoun resolvable.
 *
 * Windowed around the passage rather than taken from the top of the chapter:
 * a chapter can run to tens of thousands of characters, and the first six
 * thousand of it are no help at all in explaining something on its last page.
 * The passage is located by its own text; if it can't be found (the selection
 * spanned a page break and picked up stray whitespace, say) the chapter's
 * opening is a reasonable fallback — it at least establishes the setting.
 */
async function chapterWindow(
  documentId: string,
  userId: string,
  chapterIdx: number,
  passage: string,
): Promise<string> {
  try {
    const rows = (await db.execute(sql`
      select left(string_agg(content, E'\n\n' order by chunk_index), ${MAX_CHAPTER_SCAN_CHARS}) as text
      from document_chunks
      where document_id = ${documentId}
        and user_id = ${userId}
        and chapter_index = ${chapterIdx}
    `)) as unknown as { text: string | null }[];

    const whole = (rows[0]?.text ?? "").trim();
    if (whole.length <= CHAPTER_WINDOW_CHARS * 2) return whole;

    // Match on the passage's opening rather than the whole of it: chunking
    // inserts blank lines the selection does not have, so a long passage
    // spanning a chunk boundary would never match in full.
    const needle = passage.slice(0, 120);
    const at = whole.indexOf(needle);
    if (at < 0) return whole.slice(0, CHAPTER_WINDOW_CHARS * 2);

    return whole.slice(
      Math.max(0, at - CHAPTER_WINDOW_CHARS),
      Math.min(whole.length, at + passage.length + CHAPTER_WINDOW_CHARS),
    );
  } catch (err) {
    console.warn("explain: chapter context failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * The earlier passages in this book closest in meaning to the selection.
 *
 * Strictly `chapter_index < chapterIdx`, so nothing the reader has not reached
 * can reach the model. Fail-soft: a book with no embeddings yet (the backfill
 * runs after upload) simply contributes nothing here rather than failing the
 * whole explanation — the chapter around the passage is still plenty for most
 * questions.
 */
async function earlierContext(
  documentId: string,
  userId: string,
  chapterIdx: number,
  passage: string,
): Promise<string> {
  if (chapterIdx <= 0) return "";
  try {
    const provider = getEmbeddingsProvider();
    const [vector] = await provider.embed([clampForEmbedding(passage)], "query");
    const lit = toVectorLiteral(vector);
    const rows = (await db.execute(sql`
      select left(content, 1200) as text
      from document_chunks
      where document_id = ${documentId}
        and user_id = ${userId}
        and chapter_index is not null
        and chapter_index < ${chapterIdx}
        and embedding is not null
      order by embedding <=> ${lit}::vector
      limit 4
    `)) as unknown as { text: string | null }[];
    return rows
      .map((r) => (r.text ?? "").trim())
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, MAX_EARLIER_CHARS);
  } catch (err) {
    console.warn("explain: earlier context failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

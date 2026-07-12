import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelV1 } from "ai";
import { db } from "@/lib/db";
import { rabbitholeNodes } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { getChatModel } from "@/lib/ai/models";
import { openrouterClient, openrouterKey } from "@/lib/ai/provider";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage, budgetExceededMessage } from "@/lib/ai/budget";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { getLens, extractNodeTitle } from "@/lib/rabbithole/lenses";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mirror of lib/ai/stream-markers RABBITHOLE_SENTINEL (route modules can't
// export arbitrary consts). The client splits on this and never renders it.
const RH_SENTINEL = "<<<SB_RH_NODE:";

// Token-spend bounds: the root document anchors every branch; the parent
// answer is the immediate context the selection was made in.
const MAX_ROOT_CHARS = 16_000;
const MAX_PARENT_CHARS = 8_000;
const MAX_ANCHOR_CHARS = 2_000;
const MAX_QUESTION_CHARS = 2_000;
// A hole this deep is almost certainly a runaway loop, not curiosity.
const MAX_DEPTH = 12;

const SYSTEM = `You are the Rabbithole guide inside the user's Second Brain.
The user is reading a document, selected a passage, and asked a question about
it. Your answer becomes a standalone child document they can keep reading —
and select text inside of to go even deeper.

Rules:
- Start with a single-line markdown H1 (\`# …\`, at most 60 characters) that
  names the concept your answer covers. Then write the body.
- Write a self-contained mini-document: readable on its own, in clean markdown
  (short sections, lists or examples where they help).
- Ground yourself in the provided document context; where the question goes
  beyond it, answer from general knowledge and make the boundary clear.
- Go appropriately deep — the user chose to dig — but stay focused on the
  selected passage and question. No preamble, no "Based on the document…".`;

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

/** GET /api/rabbithole?itemId= — every node of the item's hole, oldest first. */
export async function GET(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });

  const nodes = await db
    .select({
      id: rabbitholeNodes.id,
      parentId: rabbitholeNodes.parentId,
      anchorText: rabbitholeNodes.anchorText,
      question: rabbitholeNodes.question,
      lens: rabbitholeNodes.lens,
      title: rabbitholeNodes.title,
      content: rabbitholeNodes.content,
      depth: rabbitholeNodes.depth,
      createdAt: rabbitholeNodes.createdAt,
    })
    .from(rabbitholeNodes)
    .where(and(eq(rabbitholeNodes.userId, user.id), eq(rabbitholeNodes.itemId, itemId)))
    .orderBy(asc(rabbitholeNodes.createdAt));

  return NextResponse.json({ nodes });
}

type Body = {
  itemId?: string;
  parentId?: string | null;
  anchorText?: string;
  question?: string;
  lens?: string;
  model?: string;
};

/**
 * POST /api/rabbithole — answer a branch: stream the child document as plain
 * text, persist the node once generation completes, then emit the saved node
 * as a trailing `<<<SB_RH_NODE:{…}` sentinel so the client can wire up
 * breadcrumbs + deeper branching without a refetch.
 */
export async function POST(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return new Response(error?.message ?? "Unauthorized", { status: error?.status ?? 401 });
  const userId = user.id;

  const rl = await checkRateLimit(userId, "ask", 30, 60);
  if (!rl.allowed) {
    return new Response("Rate limit reached — please wait a moment before digging again.", {
      status: 429,
    });
  }
  const budget = await checkAiBudget(userId);
  if (!budget.allowed) {
    return new Response(budgetExceededMessage(budget), { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const itemId = (body.itemId ?? "").trim();
  const anchorText = (body.anchorText ?? "").trim().slice(0, MAX_ANCHOR_CHARS);
  const customQuestion = (body.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  const lens = getLens(body.lens);

  if (!itemId) return new Response("itemId is required.", { status: 400 });
  if (!anchorText) return new Response("Select some text to dig into.", { status: 400 });
  if (!customQuestion && !lens) {
    return new Response("Ask a question or pick a lens.", { status: 400 });
  }

  const root = await getDirectoryItemStudyText(userId, itemId);
  if (!root) return new Response("Item not found.", { status: 404 });

  // Branching from inside an existing answer: that node is the passage's
  // immediate host, and fixes the child's depth.
  let parent: { id: string; title: string; content: string; depth: number } | null = null;
  if (body.parentId) {
    const [row] = await db
      .select({
        id: rabbitholeNodes.id,
        title: rabbitholeNodes.title,
        content: rabbitholeNodes.content,
        depth: rabbitholeNodes.depth,
      })
      .from(rabbitholeNodes)
      .where(
        and(
          eq(rabbitholeNodes.id, body.parentId),
          eq(rabbitholeNodes.userId, userId),
          eq(rabbitholeNodes.itemId, itemId),
        ),
      )
      .limit(1);
    if (!row) return new Response("Parent branch not found.", { status: 404 });
    parent = row;
  }
  const depth = (parent?.depth ?? 0) + 1;
  if (depth > MAX_DEPTH) {
    return new Response(`This hole is ${MAX_DEPTH} levels deep — time to come up for air.`, {
      status: 400,
    });
  }

  const question = customQuestion || lens!.prompt;

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

  const rootText = root.text.trim();
  const rootDoc = rootText.length > MAX_ROOT_CHARS
    ? rootText.slice(0, MAX_ROOT_CHARS) + "\n…[truncated]"
    : rootText;
  const parentDoc = parent
    ? parent.content.length > MAX_PARENT_CHARS
      ? parent.content.slice(0, MAX_PARENT_CHARS) + "\n…[truncated]"
      : parent.content
    : null;

  const userMessage = [
    `ROOT DOCUMENT (title: ${root.title}):\n"""\n${rootDoc || "(no readable text)"}\n"""`,
    parentDoc
      ? `PARENT BRANCH the passage was selected in (title: ${parent!.title}):\n"""\n${parentDoc}\n"""`
      : null,
    `SELECTED PASSAGE:\n"""\n${anchorText}\n"""`,
    `QUESTION:\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = streamText({
    model,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.4,
    abortSignal: req.signal,
  });
  // Fire-and-forget: the usage promise resolves when the stream finishes.
  void result.usage.then((u) => recordAiUsage(userId, u?.totalTokens ?? 0)).catch(() => {});

  const modelId = getChatModel(body.model).id;
  const parentId = parent?.id ?? null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let acc = "";
      try {
        for await (const delta of result.textStream) {
          acc += delta;
          controller.enqueue(encoder.encode(delta));
        }
        // Persist only a completed answer — an aborted stream saves nothing,
        // so a cancelled dig never leaves a half-written branch behind.
        if (!req.signal.aborted && acc.trim()) {
          const title = extractNodeTitle(acc, customQuestion || lens!.label);
          const [saved] = await db
            .insert(rabbitholeNodes)
            .values({
              userId,
              itemId,
              parentId,
              anchorText,
              question,
              lens: lens?.key ?? null,
              title,
              content: acc,
              model: modelId,
              depth,
            })
            .returning({ id: rabbitholeNodes.id });
          const payload = { id: saved.id, parentId, title, depth };
          controller.enqueue(encoder.encode(`\n${RH_SENTINEL}${JSON.stringify(payload)}`));
        }
      } catch (err) {
        if (!req.signal.aborted) {
          try {
            controller.enqueue(
              encoder.encode(
                `\n\n_(generation error: ${err instanceof Error ? err.message : "unknown"})_`,
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

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

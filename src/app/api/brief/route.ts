import { and, eq, gte, desc } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `You are an editor for a daily news briefing.
The user is reading from RSS feeds. Below is the set of unread articles for the period indicated.

Your job:
1. Group related articles into 3-6 thematic clusters (e.g. "AI safety", "Semiconductor industry", "Markets").
2. For each cluster, write 1-2 tight sentences synthesizing what's happening — do not just list the articles.
3. After each cluster, list the contributing articles as a short bulleted list with the format "- [Source] Title".
4. End with a one-paragraph "What's notable" that picks out the 1-2 stories that matter most and why.

Tone: confident, terse, like an FT or Economist editor's morning note. No filler, no preamble, no headings like "Here's your brief". Start straight in with the first cluster heading.`;

type ArticleForBrief = {
  id: string;
  title: string;
  excerpt: string | null;
  fullText: string | null;
  feedTitle: string;
};

const MAX_BODY_CHARS = 1500;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildArticleBlock(rows: ArticleForBrief[]): string {
  return rows
    .map((r, i) => {
      const body = r.fullText ? stripHtml(r.fullText) : r.excerpt ?? "";
      const trimmed = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + "…" : body;
      return `[${i + 1}] (${r.feedTitle}) ${r.title}\n${trimmed}`.trim();
    })
    .join("\n\n");
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const user = auth.user;

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "ANTHROPIC_API_KEY not configured. Add it to your env vars to enable the Daily Brief.",
      { status: 503 },
    );
  }

  // Optional user-customized system prompt
  let customPrompt: string | null = null;
  try {
    const body = (await req.json()) as { systemPrompt?: string };
    if (typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 0) {
      customPrompt = body.systemPrompt.trim();
    }
  } catch {
    // No body or invalid JSON — use default
  }
  const systemPrompt = customPrompt ?? DEFAULT_SYSTEM_PROMPT;

  // Try last 24h first, then widen the window so the brief still works even if
  // the user hasn't synced today.
  const windows = [
    { since: new Date(Date.now() - 24 * 60 * 60 * 1000), label: "the last 24 hours" },
    { since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), label: "the last week" },
    { since: null as Date | null, label: "your most recent unread" },
  ];

  async function fetchRows(since: Date | null) {
    const conds = [eq(articles.userId, user.id), eq(articles.readStatus, "unread")];
    if (since) conds.push(gte(articles.publishDate, since));
    return db
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articles.excerpt,
        fullText: articles.fullText,
        feedTitle: feeds.title,
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...conds))
      .orderBy(desc(articles.publishDate))
      .limit(60);
  }

  let rows: Awaited<ReturnType<typeof fetchRows>> = [];
  let windowLabel = windows[0].label;
  for (const w of windows) {
    rows = await fetchRows(w.since);
    windowLabel = w.label;
    if (rows.length > 0) break;
  }

  if (rows.length === 0) {
    return new Response(
      "No unread articles to brief on. Add some feeds and sync them, then come back.",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const articleBlock = buildArticleBlock(rows);
  const periodLine = `\n\n[Briefing window: ${windowLabel}, ${rows.length} unread articles]`;

  // Anthropic prompt caching: cache the large article block so daily reruns (and
  // re-generations within the same conversation window) reuse the same tokens.
  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Articles to brief on:${periodLine}\n\n${articleBlock}`,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          {
            type: "text",
            text: "Write the daily brief now.",
          },
        ],
      },
    ],
    temperature: 0.4,
  });

  return result.toTextStreamResponse();
}

import { and, eq, gte, desc } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an editor for a daily news briefing.
The user is reading from RSS feeds. Below is the set of unread articles from the last 24 hours.

Your job:
1. Group related articles into 3–6 thematic clusters (e.g. "AI safety", "Semiconductor industry", "Markets").
2. For each cluster, write 1–2 tight sentences explaining what's happening — synthesize, do not just list.
3. After each cluster, list the contributing articles as a short bulleted list with the format "- [Source] Title".
4. End with a one-paragraph "What's notable" that picks out the 1–2 stories that matter most and why.

Tone: confident, terse, like an FT or Economist editor's morning note. No filler, no preamble, no headings like "Here's your brief". Start straight in with the first cluster heading.`;

type ArticleForBrief = {
  id: string;
  title: string;
  excerpt: string | null;
  feedTitle: string;
};

function buildArticleBlock(rows: ArticleForBrief[]): string {
  return rows
    .map(
      (r, i) =>
        `[${i + 1}] (${r.feedTitle}) ${r.title}\n${(r.excerpt ?? "").slice(0, 280)}`.trim(),
    )
    .join("\n\n");
}

export async function GET() {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "ANTHROPIC_API_KEY not configured. Add it to your env vars to enable the Daily Brief.",
      { status: 503 },
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      excerpt: articles.excerpt,
      feedTitle: feeds.title,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(
      and(
        eq(articles.userId, user.id),
        eq(articles.readStatus, "unread"),
        gte(articles.publishDate, since),
      ),
    )
    .orderBy(desc(articles.publishDate))
    .limit(60);

  if (rows.length === 0) {
    return new Response(
      "No unread articles from the last 24 hours. Sync your feeds or come back tomorrow.",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const articleBlock = buildArticleBlock(rows);

  // Anthropic prompt caching: cache the large article block so daily reruns (and
  // re-generations within the same conversation window) reuse the same tokens.
  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Articles to brief on:\n\n${articleBlock}`,
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

import { and, eq, gte, desc } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Trailing markers appended after the brief text. The client splits on these
// and never renders them. Sources go in the body (not a header) because a
// 60-article map can exceed proxy header-size caps. Mirrors /api/ask.
// NOT exported — Next.js route modules only allow specific named exports.
const BRIEFSOURCES_SENTINEL = "<<<SB_BRIEFSOURCES:";
const USAGE_SENTINEL = "<<<SB_USAGE:";

const DEFAULT_SYSTEM_PROMPT = `You are my personal Second Brain curator. I already receive a highly detailed daily news summary via email, so your goal here is NOT to summarize everything. Your goal is rapid triage and discovery.

Review the provided JSON list of my unread articles and newly uploaded documents from the last 24 hours. Generate a short, punchy dashboard using the following strict format:

### High-Priority (Read Now)
Identify the 1-3 most substantial, unique, or high-signal pieces.
* Provide the title, followed by its bracketed reference number (e.g. [3]) so I can jump to the source.
* Write a 1-sentence hook explaining exactly *why* it's worth my time.
* List its primary tag.

### Thematic Clusters (For Batch Reading)
Group the remaining worthwhile articles into broad themes (e.g., "4 items on AI Tools", "2 items on Macroeconomics").
* Do not summarize the individual articles.
* Just list the theme, the article count, and a 1-sentence summary of the overarching trend across those articles.

### Quick Clear (Low Signal / Skip)
Identify any articles that appear to be clickbait, standard PR announcements, highly repetitive news, or low-value fluff.
* List their titles so I can confidently mark them as read or delete them without opening them.

Keep your tone sharp, objective, and extremely concise. Output in clean Markdown.`;

type ArticleForBrief = {
  id: string;
  title: string;
  url: string;
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

  // Daily Brief is expensive (full-text bundle). 10 generations / minute.
  const rl = await checkRateLimit(user.id, "brief", 10, 60);
  if (!rl.allowed) {
    return new Response("Rate limit reached — wait a moment before regenerating the brief.", {
      status: 429,
    });
  }

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
        url: articles.url,
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

  // Source map for the client, aligned to the [n] numbering in the article
  // block above so the brief's inline references link back to the right item.
  const sourceMap = rows.map((r, i) => ({
    n: i + 1,
    id: r.id,
    title: r.title,
    url: r.url,
    feedTitle: r.feedTitle,
  }));

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

  // Stream the brief text, then append source + usage sentinels the client
  // strips and parses. Sources/usage aren't known until generation finishes,
  // so they can't go in headers that were already sent.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) {
          controller.enqueue(encoder.encode(delta));
        }
        controller.enqueue(
          encoder.encode(`\n${BRIEFSOURCES_SENTINEL}${JSON.stringify(sourceMap)}`),
        );
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

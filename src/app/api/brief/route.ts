import { createHash } from "crypto";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { streamText } from "ai";
import { aiAvailable, smartModel } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCachedBrief, setCachedBrief } from "@/lib/brief-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

const BRIEF_LIMIT = 60;

// Widening windows: last 24h, then a week, then most-recent unread — so the
// brief still works when the user hasn't synced today. Shared by POST (which
// builds the brief) and GET (the cheap fingerprint check).
function briefWindows() {
  return [
    { since: new Date(Date.now() - 24 * 60 * 60 * 1000), label: "the last 24 hours" },
    { since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), label: "the last week" },
    { since: null as Date | null, label: "your most recent unread" },
  ];
}

/** Order-independent hash of the unread-article id set the brief was built on. */
function fingerprint(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join(",")).digest("base64");
}

/** Cheap id-only mirror of the brief query — used by GET to detect drift. */
async function unreadBriefIds(userId: string): Promise<string[]> {
  for (const w of briefWindows()) {
    const conds = [eq(articles.userId, userId), eq(articles.readStatus, "unread")];
    if (w.since) conds.push(gte(articles.publishDate, w.since));
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(...conds))
      .orderBy(desc(articles.publishDate))
      .limit(BRIEF_LIMIT);
    if (rows.length > 0) return rows.map((r) => r.id);
  }
  return [];
}

/**
 * GET /api/brief — cheap fingerprint of the current unread set (id-only, no
 * full text, no model). The client compares it against the fingerprint stored
 * with its cached brief to show a "new articles — regenerate" nudge without
 * paying for a full regeneration.
 */
export async function GET() {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const ids = await unreadBriefIds(auth.user.id);
  return Response.json({ fingerprint: fingerprint(ids), count: ids.length });
}

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

  if (!aiAvailable()) {
    return new Response(
      "No AI provider configured. Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to your env vars to enable the Daily Brief.",
      { status: 503 },
    );
  }

  // Optional user-customized system prompt + a force flag (explicit Regenerate
  // bypasses the server cache).
  let customPrompt: string | null = null;
  let force = false;
  try {
    const body = (await req.json()) as { systemPrompt?: string; force?: boolean };
    if (typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 0) {
      customPrompt = body.systemPrompt.trim();
    }
    force = body.force === true;
  } catch {
    // No body or invalid JSON — use default
  }
  const systemPrompt = customPrompt ?? DEFAULT_SYSTEM_PROMPT;

  async function fetchRows(since: Date | null) {
    const conds = [eq(articles.userId, user.id), eq(articles.readStatus, "unread")];
    if (since) conds.push(gte(articles.publishDate, since));
    return db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        excerpt: articles.excerpt,
        // Cap raw full_text in SQL: only ~1500 plain chars per article reach the
        // model (after stripHtml), so shipping whole multi-MB article bodies for
        // 60 rows is pure waste. 9000 raw chars leaves headroom for HTML tags.
        fullText: sql<string | null>`left(${articles.fullText}, 9000)`.as("full_text"),
        feedTitle: feeds.title,
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...conds))
      .orderBy(desc(articles.publishDate))
      .limit(BRIEF_LIMIT);
  }

  let rows: Awaited<ReturnType<typeof fetchRows>> = [];
  let windowLabel = briefWindows()[0].label;
  for (const w of briefWindows()) {
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
  const briefFingerprint = fingerprint(rows.map((r) => r.id));

  // Source map for the client, aligned to the [n] numbering in the article
  // block above so the brief's inline references link back to the right item.
  const sourceMap = rows.map((r, i) => ({
    n: i + 1,
    id: r.id,
    title: r.title,
    url: r.url,
    feedTitle: r.feedTitle,
  }));

  // Server-side cache: same unread set + same prompt → reuse the brief and skip
  // the model entirely (unless the user forced a regenerate).
  const promptHash = createHash("sha1").update(systemPrompt).digest("base64");
  const cacheKey = `${user.id}:${briefFingerprint}:${promptHash}`;
  if (!force) {
    const hit = getCachedBrief(cacheKey);
    if (hit) {
      const body =
        `${hit.content}` +
        `\n${BRIEFSOURCES_SENTINEL}${JSON.stringify(hit.sourceMap)}` +
        `\n${USAGE_SENTINEL}${JSON.stringify(hit.usage)}`;
      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-brief-fingerprint": briefFingerprint,
          "x-brief-cache": "hit",
        },
      });
    }
  }

  // Anthropic prompt caching: cache the large article block so daily reruns (and
  // re-generations within the same conversation window) reuse the same tokens.
  const result = streamText({
    model: smartModel(),
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
    abortSignal: req.signal,
  });

  // Stream the brief text, then append source + usage sentinels the client
  // strips and parses. Sources/usage aren't known until generation finishes,
  // so they can't go in headers that were already sent.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let acc = "";
        for await (const delta of result.textStream) {
          acc += delta;
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
        // Cache the finished brief for reuse on reload / other devices.
        if (acc.trim()) setCachedBrief(cacheKey, { content: acc, sourceMap, usage: payload });
      } catch (err) {
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
      "x-brief-fingerprint": briefFingerprint,
    },
  });
}

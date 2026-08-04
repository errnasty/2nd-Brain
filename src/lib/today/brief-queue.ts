/**
 * The unread-article queue a Daily Brief is built from.
 *
 * Extracted from the route because three callers now need exactly the same
 * queue: the plan endpoint (which classifies it into desks with no model at
 * all), each section generation (which needs the bodies for its own slice), and
 * the fingerprint check that detects drift. If any of them disagreed about the
 * window, the ordering or the limit, the `[n]` numbers in a section would point
 * at different articles than the plan's source map — so the query lives in one
 * place and everything derives from it.
 */

import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, type BriefSourceRef } from "@/lib/db/schema";
import { trendingDayStart } from "@/lib/trending/day";
import type { BriefArticleInput } from "./brief-prompts";
import type { PlanArticle } from "./brief-plan";

/**
 * Widening windows: today, then a week, then most-recent unread — so the brief
 * still works when the user hasn't synced today.
 *
 * The first window is deliberately the *trending* day, taken from the same
 * helper the scoring pass uses rather than a second `now - 24h` written out
 * here. That shared boundary is what makes a daily brief a brief on the day's
 * trending stories: everything the trending pass scored is inside this window
 * by construction, and everything it retired is outside it. Two independent
 * definitions would have left a seam at the edge where the brief either quotes
 * a story trending no longer, or drops one that is.
 *
 * The wider windows are the "you haven't synced in days" path. Nothing in them
 * carries a trend score — the pass only scores the day — so they degrade to
 * exactly the reverse-chronological brief that ran before trending existed.
 */
export function briefWindows(now: Date = new Date()) {
  return [
    { since: trendingDayStart(now), label: "today" },
    { since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), label: "the last week" },
    { since: null as Date | null, label: "your most recent unread" },
  ];
}

/** Order-independent hash of the unread-article id set the brief was built on. */
export function briefFingerprint(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join(",")).digest("base64");
}

/**
 * Order-DEPENDENT hash of the same ids.
 *
 * The two exist because the queue now has two ways to move, and they deserve
 * different responses. New articles arriving changes the SET, which is worth
 * telling the user about ("new articles — regenerate"). The trending cron
 * re-ranking the same articles changes only the ORDER, which the user does not
 * need to hear about — but it silently invalidates the `[n]` numbering a
 * half-generated brief is citing, so the client has to re-plan.
 *
 * Hashing the set for the nudge and the sequence for the drift check keeps a
 * re-rank from firing an hourly "something changed" prompt at a user whose
 * queue is in fact identical.
 */
export function briefOrderFingerprint(ids: string[]): string {
  return createHash("sha1").update(ids.join(",")).digest("base64");
}

/**
 * Hash of the settings a sectioned brief was generated under (level + followed
 * desks), stored in the `promptHash` column the single-pass brief uses for the
 * hash of its custom prompt. The prefix keeps the two distinguishable: a stored
 * brief only gets compared against current settings when it was a sectioned one
 * in the first place.
 */
const SECTIONED_HASH_PREFIX = "sectioned:";

export function briefSettingsHash(key: string): string {
  return SECTIONED_HASH_PREFIX + createHash("sha1").update(key).digest("base64");
}

export function isSectionedBriefHash(promptHash: string): boolean {
  return promptHash.startsWith(SECTIONED_HASH_PREFIX);
}

/** Optional env override, kept from the pre-sectioned brief. */
function envLimit(): number | null {
  const raw = Number(process.env.BRIEF_ARTICLE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** The article pool for a level, honouring the env cap when one is set. */
export function queueLimit(levelLimit: number): number {
  const override = envLimit();
  return override ? Math.min(levelLimit, override) : levelLimit;
}

/** Plain-text chars per article, honouring the env cap when one is set. */
export function bodyCharLimit(levelChars: number): number {
  const raw = Number(process.env.BRIEF_BODY_CHARS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(levelChars, raw) : levelChars;
}

/** Only the lead of an excerpt matters for desk classification. */
const CLASSIFY_EXCERPT_CHARS = 600;

const baseConds = (userId: string, since: Date | null) => {
  const conds = [eq(articles.userId, userId), eq(articles.readStatus, "unread")];
  if (since) conds.push(gte(articles.publishDate, since));
  return conds;
};

/**
 * The queue order, shared by every read so the `[n]` numbering agrees.
 *
 * Trending first, then newest — and since the pass scores the day and nothing
 * else, the head of this queue IS the day's trending stories, in order of how
 * hot they are, followed by the rest of the day newest-first. That is what the
 * brief's lead, its desk sections and its article cap all draw from, so the
 * biggest stories of the day survive every one of those cuts.
 *
 * The publish-date tie-break is not decoration: `trend_score` is 0 until the
 * trending cron has scored an article, so on a fresh database — or the desktop
 * app, where no cron runs — this collapses to exactly the reverse-chronological
 * order the brief used before. The id is the final tie-break, because
 * publish_date is nullable and non-unique and a partial order would let two
 * reads of the same set disagree about `[n]`.
 */
const QUEUE_ORDER = [
  desc(articles.trendScore),
  desc(articles.publishDate),
  desc(articles.id),
] as const;

/**
 * Run `fetch` against each window in turn, stopping at the first that returns
 * anything. Every queue read shares this so they all land on the same window.
 */
async function widen<T>(
  fetch: (since: Date | null) => Promise<T[]>,
): Promise<{ rows: T[]; windowLabel: string }> {
  const windows = briefWindows();
  for (const w of windows) {
    const rows = await fetch(w.since);
    if (rows.length > 0) return { rows, windowLabel: w.label };
  }
  return { rows: [], windowLabel: windows[0].label };
}

/** Cheap id-only mirror of the queue — used to detect drift without a model. */
export async function unreadBriefIds(userId: string, limit: number): Promise<string[]> {
  const { rows } = await widen((since) =>
    db
      .select({ id: articles.id })
      .from(articles)
      .where(and(...baseConds(userId, since)))
      .orderBy(...QUEUE_ORDER)
      .limit(limit),
  );
  return rows.map((r) => r.id);
}

export type PlanRow = {
  id: string;
  title: string;
  url: string;
  excerpt: string | null;
  feedTitle: string;
  wordCount: number | null;
  hasFullText: boolean;
  /** 0 until the trending cron has scored it. */
  trendScore: number;
  /** The story this is one telling of; null when unscored or unique. */
  clusterId: string | null;
};

/**
 * The queue as the planner sees it: enough to classify each article into a desk
 * and to build the source map, with no article bodies at all. This is what the
 * Today tab loads on every visit, so it stays deliberately small.
 */
export async function fetchPlanRows(
  userId: string,
  limit: number,
): Promise<{ rows: PlanRow[]; windowLabel: string }> {
  return widen((since) =>
    db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        excerpt: sql<string | null>`left(${articles.excerpt}, ${CLASSIFY_EXCERPT_CHARS})`.as(
          "excerpt",
        ),
        feedTitle: feeds.title,
        wordCount: articles.wordCount,
        hasFullText: sql<boolean>`${articles.fullText} is not null`.as("has_full_text"),
        trendScore: articles.trendScore,
        clusterId: articles.clusterId,
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...baseConds(userId, since)))
      .orderBy(...QUEUE_ORDER)
      .limit(limit),
  );
}

export type SectionRow = PlanRow & { fullText: string | null };

/**
 * Article bodies for a specific set of ids.
 *
 * Deliberately NOT "the whole queue, with bodies". A section cites at most a
 * dozen articles, but the pool it's planned against is now up to 120 — pulling
 * every body to use ten of them would ship close to a megabyte out of Postgres
 * per section, on a request that has under ten seconds to also run a model
 * call. So the section endpoint plans on the light rows (no bodies at all) and
 * then fetches bodies for just the refs it actually needs.
 *
 * `rawChars` caps `full_text` in SQL — only `bodyChars` plain characters per
 * article ever reach the model after `stripHtml`, so the multiplier is just
 * headroom for the HTML tags that get stripped out.
 */
export async function fetchBodies(
  userId: string,
  ids: string[],
  rawChars: number,
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: articles.id,
      fullText: sql<string | null>`left(${articles.fullText}, ${rawChars})`.as("full_text"),
      excerpt: articles.excerpt,
    })
    .from(articles)
    .where(and(eq(articles.userId, userId), inArray(articles.id, ids)));

  const out = new Map<string, string | null>();
  for (const r of rows) out.set(r.id, r.fullText ?? r.excerpt ?? null);
  return out;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Source map for the client, aligned to the `[n]` numbering. */
export function briefSourceMap(rows: Pick<PlanRow, "id" | "title" | "url" | "feedTitle">[]): BriefSourceRef[] {
  return rows.map((r, i) => ({
    n: i + 1,
    id: r.id,
    title: r.title,
    url: r.url,
    feedTitle: r.feedTitle,
  }));
}

/** Rows as the planner wants them (classification + ranking signals only). */
export function toPlanArticles(rows: PlanRow[]): PlanArticle[] {
  return rows.map((r) => ({
    title: r.title,
    excerpt: r.excerpt,
    feedTitle: r.feedTitle,
    wordCount: r.wordCount,
    hasFullText: r.hasFullText,
    trendScore: r.trendScore,
    clusterId: r.clusterId,
  }));
}

/**
 * The `[n]`-numbered inputs for one section, in the order the refs were given.
 *
 * `bodies` is keyed by article id and comes from `fetchBodies` — the rows
 * themselves carry no body text, so a section's input is assembled from the
 * light plan rows plus bodies for its own refs only.
 */
export function toArticleInputs(
  rows: PlanRow[],
  refs: number[],
  bodies: Map<string, string | null> = new Map(),
): BriefArticleInput[] {
  return refs
    .filter((n) => n >= 1 && n <= rows.length)
    .map((n) => {
      const r = rows[n - 1];
      const raw = bodies.get(r.id) ?? r.excerpt ?? "";
      return {
        n,
        title: r.title,
        feedTitle: r.feedTitle,
        body: raw ? stripHtml(raw) : "",
      };
    });
}

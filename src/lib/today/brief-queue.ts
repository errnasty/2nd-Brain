/**
 * The unread-article queue a Daily Brief is built from.
 *
 * The queue is no longer "the first N rows of a query". It is a SELECTION: a
 * wide, title-only scan of several hundred unread articles, collapsed into
 * stories and narrowed to a bounded, desk-diverse set — see
 * `brief-retrieval.ts` for why, and for the whole of the decision-making. This
 * file is the I/O half of that: the two queries (wide and thin, then narrow and
 * fat) with the pure selector in between.
 *
 * It lives apart from the route because four callers need exactly the same
 * queue: the plan endpoint (which classifies it into desks with no model at
 * all), each section generation (which needs the bodies for its own slice), the
 * XP mapping, and the fingerprint check that detects drift. If any of them
 * disagreed about the window, the selection or the limit, the `[n]` numbers in
 * a section would point at different articles than the plan's source map — so
 * every one of them goes through `fetchBriefQueue`, and selection is a pure
 * function of inputs they all supply identically.
 */

import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, type BriefSourceRef } from "@/lib/db/schema";
import { trendingDayStart } from "@/lib/trending/day";
import type { BriefTopic } from "./topics";
import { selectBriefQueue, type QueueSelection, type ScanArticle } from "./brief-retrieval";
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
 * Hash of the settings a sectioned brief was generated under — depth, followed
 * desks, the reader's own desks, their standing instructions.
 *
 * Stored in the `promptHash` column, which is named for what it used to hold:
 * the hash of a whole-brief custom prompt, back when customization replaced the
 * generation rather than layering into it. The prefix survives that history so
 * a brief stored under the old scheme is never mistaken for one written under
 * the current settings.
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

/**
 * How wide the title-only scan goes, honouring `BRIEF_SCAN_LIMIT`.
 *
 * Separate from `queueLimit` because the two cost completely different things:
 * the queue limit bounds excerpts, bodies, classifications and prompt lines,
 * while the scan limit bounds one `select id, title` — so the scan can be
 * several times wider without moving peak memory. Never narrower than the queue
 * it feeds, or selection would be choosing from less than it is asked to keep.
 */
export function scanLimit(levelScan: number, levelLimit: number): number {
  const raw = Number(process.env.BRIEF_SCAN_LIMIT);
  const override = Number.isFinite(raw) && raw > 0 ? raw : null;
  const wanted = override ? Math.min(levelScan, override) : levelScan;
  return Math.max(wanted, queueLimit(levelLimit));
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
  /** Distinct feeds carrying this article's story across the WHOLE scan — not
   *  just the tellings that made the queue. Null when selection didn't run. */
  storyFeeds: number | null;
};

/** What the brief was built from, beyond the rows themselves. */
export type BriefQueue = {
  rows: PlanRow[];
  windowLabel: string;
  coverage: QueueSelection["coverage"];
  omitted: QueueSelection["omitted"];
  /** Cross-desk threads among the selected stories — see `brief-retrieval.ts`. */
  threads: QueueSelection["threads"];
  /**
   * Every title the scan saw, selected or not.
   *
   * Kept for one job: the "outside your feeds" section's entire claim is that
   * the reader's own feeds did not carry a story, and that has to be checked
   * against everything they have, not against the slice selection kept. A
   * story sitting unselected in the queue is still not a blind spot.
   */
  scanTitles: string[];
};

/**
 * Stage 1: the wide scan. Titles, feed names and the ranking signals — no
 * excerpts, no bodies, no url. This is the only query whose row count grows
 * with the scan width, which is what makes widening it nearly free.
 */
async function fetchScanRows(
  userId: string,
  limit: number,
): Promise<{ rows: ScanArticle[]; windowLabel: string }> {
  return widen((since) =>
    db
      .select({
        id: articles.id,
        title: articles.title,
        feedId: articles.feedId,
        feedTitle: feeds.title,
        publishDate: articles.publishDate,
        trendScore: articles.trendScore,
        clusterId: articles.clusterId,
        wordCount: articles.wordCount,
        hasFullText: sql<boolean>`${articles.fullText} is not null`.as("has_full_text"),
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...baseConds(userId, since)))
      .orderBy(...QUEUE_ORDER)
      .limit(limit),
  );
}

/**
 * Stage 3: the excerpt for each SELECTED article, and its url for the source
 * map. Two queries instead of one, deliberately — the first is wide and thin,
 * this one is narrow and fat, and keeping them apart is the whole point of the
 * split. Falls back to the scan row when a row has vanished under us.
 */
async function hydrateSelected(userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { url: string; excerpt: string | null }>();
  const rows = await db
    .select({
      id: articles.id,
      url: articles.url,
      excerpt: sql<string | null>`left(${articles.excerpt}, ${CLASSIFY_EXCERPT_CHARS})`.as(
        "excerpt",
      ),
    })
    .from(articles)
    .where(and(eq(articles.userId, userId), inArray(articles.id, ids)));
  return new Map(rows.map((r) => [r.id, { url: r.url, excerpt: r.excerpt }]));
}

/**
 * The brief's queue: scan wide, select stories, hydrate the survivors.
 *
 * Every caller that needs to agree about `[n]` goes through here — the plan
 * endpoint, each section generation, the XP mapping and the drift check — so
 * they all run the same selection over the same scan and land on the same
 * numbering. That is why selection is a pure function of its inputs (see
 * `brief-retrieval.ts`): the same queue and the same preferences must produce
 * the same list on every one of those calls.
 *
 * `hydrate: false` stops before the excerpt query, for the drift check, which
 * only ever looks at ids.
 */
export async function fetchBriefQueue(
  userId: string,
  opts: {
    limit: number;
    scanLimit: number;
    priority?: string[];
    deskWeights?: Record<string, number>;
    feedTrust?: Record<string, number>;
    isFollowed?: (title: string) => boolean;
    ruledOut?: (title: string, deskId: string) => boolean;
    desks?: BriefTopic[];
    hydrate?: boolean;
    now?: Date;
  },
): Promise<BriefQueue> {
  const { rows: scan, windowLabel } = await fetchScanRows(userId, opts.scanLimit);
  const selection = selectBriefQueue(scan, {
    limit: opts.limit,
    priority: opts.priority,
    deskWeights: opts.deskWeights,
    feedTrust: opts.feedTrust,
    isFollowed: opts.isFollowed,
    ruledOut: opts.ruledOut,
    desks: opts.desks,
    now: opts.now,
  });

  const base = selection.selected.map((a) => ({
    id: a.id,
    title: a.title,
    url: "",
    excerpt: null as string | null,
    feedTitle: a.feedTitle,
    wordCount: a.wordCount,
    hasFullText: a.hasFullText,
    trendScore: a.trendScore,
    clusterId: a.clusterId,
    storyFeeds: selection.storyFeeds.get(a.id) ?? null,
  }));

  const scanTitles = scan.map((a) => a.title);
  if (opts.hydrate === false) {
    return {
      rows: base,
      windowLabel,
      coverage: selection.coverage,
      omitted: selection.omitted,
      threads: selection.threads,
      scanTitles,
    };
  }

  const extra = await hydrateSelected(
    userId,
    base.map((r) => r.id),
  );
  for (const row of base) {
    const hit = extra.get(row.id);
    if (!hit) continue;
    row.url = hit.url;
    row.excerpt = hit.excerpt;
  }
  return {
    rows: base,
    windowLabel,
    coverage: selection.coverage,
    omitted: selection.omitted,
    threads: selection.threads,
    scanTitles,
  };
}

/** Cheap id-only mirror of the queue — used to detect drift without a model. */
export async function unreadBriefIds(
  userId: string,
  opts: {
    limit: number;
    scanLimit: number;
    priority?: string[];
    deskWeights?: Record<string, number>;
    feedTrust?: Record<string, number>;
    isFollowed?: (title: string) => boolean;
    ruledOut?: (title: string, deskId: string) => boolean;
    desks?: BriefTopic[];
  },
): Promise<string[]> {
  const { rows } = await fetchBriefQueue(userId, { ...opts, hydrate: false });
  return rows.map((r) => r.id);
}

/** An article the reader has already been through, offered as background. */
export type ReadContextRow = { title: string; feedTitle: string };

/**
 * Stories from today that the reader has already read.
 *
 * The brief's queue is unread-only, which is right — it exists to deal with
 * what is left. But it means the brief is blind to what the reader did an hour
 * ago: read three pieces on a story over breakfast and the lead will either
 * introduce it from scratch as though it were news to them, or drop it. Both
 * are worse than the obvious thing, which is to carry on from what they know.
 *
 * So these go into the prompt as CONTEXT, never as citable refs — they aren't
 * in the source map, and a citation pointing at them would resolve to the
 * wrong article.
 *
 * ## "Read today" is inferred, not recorded
 *
 * There is no `read_at` column; `updated_at` can't stand in for one, because
 * the hourly trending pass rewrites scores on every recent article and would
 * make every one of them look freshly touched. What IS sound is the day
 * window: an article published inside it that is already marked read was, in
 * all but the strangest cases, read inside it too. That keeps this honest
 * without inventing a signal the database doesn't have.
 */
export async function fetchReadContext(
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<ReadContextRow[]> {
  try {
    return await db
      .select({ title: articles.title, feedTitle: feeds.title })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(
        and(
          eq(articles.userId, userId),
          eq(articles.readStatus, "read"),
          gte(articles.publishDate, trendingDayStart(now)),
        ),
      )
      // Trending first: of what they read, the stories the brief is most
      // likely to want to build on are the ones everyone else covered too.
      .orderBy(desc(articles.trendScore), desc(articles.publishDate))
      .limit(limit);
  } catch {
    // Background is a bonus, never a dependency — a failure here costs the
    // brief nothing but the continuity.
    return [];
  }
}

export type SectionRow = PlanRow & { fullText: string | null };

/**
 * Article bodies for a specific set of ids.
 *
 * Deliberately NOT "the whole queue, with bodies". A section cites at most a
 * dozen articles, but the queue it's planned against runs to well over a
 * hundred, drawn from a scan several times wider than that — pulling every body
 * to use ten of them would ship megabytes out of Postgres per section, on a
 * request that also has to run a model call. So the section endpoint plans on
 * the light rows (no bodies at all) and then fetches bodies for just the refs
 * it actually needs.
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

/**
 * Why each cited article is in the brief at all.
 *
 * Every part of this was already computed to BUILD the brief — which desk
 * claimed the story, how many outlets carried it, how hot it was, where it
 * landed in the queue — and then thrown away at the point the reader might
 * want it. Handing it over costs one pass over rows already in memory and no
 * model call whatsoever, which is what makes it affordable to attach to every
 * citation rather than to a chosen few.
 */
export type SourceWhy = {
  n: number;
  /** Desk that claimed the story, already resolved to its label. */
  desk: string | null;
  /** …and its id, so a correction names the desk rather than a string that
   *  happens to read the same as another one. */
  deskId: string | null;
  /** Distinct outlets carrying it across the whole scan. */
  outlets: number;
  /** Position in the queue — 1 is the day's biggest story. */
  rank: number;
  /** Whether the trending pass had scored it at all. */
  scored: boolean;
  /** Whether the reader is following this story. */
  followed: boolean;
};

export function briefWhyMap(
  rows: PlanRow[],
  opts: {
    deskOf: (ref: number) => { id: string; label: string } | null;
    isFollowed?: (title: string) => boolean;
  },
): SourceWhy[] {
  return rows.map((r, i) => ({
    n: i + 1,
    desk: opts.deskOf(i + 1)?.label ?? null,
    deskId: opts.deskOf(i + 1)?.id ?? null,
    outlets: Math.max(1, r.storyFeeds ?? 1),
    rank: i + 1,
    scored: (r.trendScore ?? 0) > 0,
    followed: opts.isFollowed?.(r.title) ?? false,
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
    storyFeeds: r.storyFeeds,
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

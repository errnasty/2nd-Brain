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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, type BriefSourceRef } from "@/lib/db/schema";
import type { BriefArticleInput } from "./brief-prompts";
import type { PlanArticle } from "./brief-plan";

/**
 * Widening windows: last 24h, then a week, then most-recent unread — so the
 * brief still works when the user hasn't synced today.
 */
export function briefWindows() {
  return [
    { since: new Date(Date.now() - 24 * 60 * 60 * 1000), label: "the last 24 hours" },
    { since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), label: "the last week" },
    { since: null as Date | null, label: "your most recent unread" },
  ];
}

/** Order-independent hash of the unread-article id set the brief was built on. */
export function briefFingerprint(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join(",")).digest("base64");
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
      .orderBy(desc(articles.publishDate))
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
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...baseConds(userId, since)))
      .orderBy(desc(articles.publishDate))
      .limit(limit),
  );
}

export type SectionRow = PlanRow & { fullText: string | null };

/**
 * The queue with bodies, for generating a section. `rawChars` caps `full_text`
 * in SQL — only `bodyChars` plain characters per article ever reach the model
 * (after `stripHtml`), so shipping whole multi-MB bodies out of Postgres is
 * pure waste; the multiplier leaves headroom for the HTML tags that get
 * stripped.
 */
export async function fetchSectionRows(
  userId: string,
  limit: number,
  rawChars: number,
): Promise<{ rows: SectionRow[]; windowLabel: string }> {
  return widen((since) =>
    db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        excerpt: articles.excerpt,
        feedTitle: feeds.title,
        wordCount: articles.wordCount,
        hasFullText: sql<boolean>`${articles.fullText} is not null`.as("has_full_text"),
        fullText: sql<string | null>`left(${articles.fullText}, ${rawChars})`.as("full_text"),
      })
      .from(articles)
      .innerJoin(feeds, eq(feeds.id, articles.feedId))
      .where(and(...baseConds(userId, since)))
      .orderBy(desc(articles.publishDate))
      .limit(limit),
  );
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

/** Rows as the planner wants them (classification signals only). */
export function toPlanArticles(rows: PlanRow[]): PlanArticle[] {
  return rows.map((r) => ({
    title: r.title,
    excerpt: r.excerpt,
    feedTitle: r.feedTitle,
    wordCount: r.wordCount,
    hasFullText: r.hasFullText,
  }));
}

/** The `[n]`-numbered inputs for one section, in the order the refs were given. */
export function toArticleInputs(rows: SectionRow[], refs: number[]): BriefArticleInput[] {
  return refs
    .filter((n) => n >= 1 && n <= rows.length)
    .map((n) => {
      const r = rows[n - 1];
      return {
        n,
        title: r.title,
        feedTitle: r.feedTitle,
        body: r.fullText ? stripHtml(r.fullText) : r.excerpt ?? "",
      };
    });
}

/**
 * XP for reading the Daily Brief, routed to the folders the reading was about.
 *
 * ## Why the split
 *
 * The brief is the one place in the app that mixes every subject at once. A
 * single section can cover three Data Science articles and one Geopolitics
 * article, and paying a flat amount into a generic "Reading" skill would throw
 * away exactly the information that makes the brief worth reading: what you
 * actually spent your attention on.
 *
 * So each section's budget is divided across the folders its cited articles
 * came from, in proportion to how much of the section each accounted for, and
 * granted through the ordinary `awardXp` path with a representative article
 * from that folder. `awardXp` already resolves an article to its folder's
 * skill, so nothing new is needed to make the routing work — only the split.
 *
 * ## Why it can't be trusted to the client
 *
 * The client says "I read section X of today's brief". It does NOT say how much
 * that is worth, which articles were in it, or which folders they belong to —
 * all of that is re-derived here from the section key and the server's own
 * queue. Otherwise reading one section and lying about the rest would be the
 * cheapest XP in the app.
 *
 * Idempotency is per (section, folder, day), so re-reading — or two devices
 * reporting the same scroll — pays once.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, folders, xpEvents } from "@/lib/db/schema";
import { awardXp, type AwardResult } from "@/lib/gamify/award";
import { XP_RULES, splitXpByWeight } from "@/lib/gamify/rules";
import { computeStreak, dayKey } from "@/lib/study/streak";

/** Idempotency namespace for a section read. */
const SECTION_REF_KIND = "brief_section";
/** …and for the whole-brief completion bonus. */
const COMPLETE_REF_KIND = "brief_complete";
/** …and for opening a source out of the brief. */
const SOURCE_REF_KIND = "brief_source";

export type BriefXpAward = {
  /** Total XP credited by this call. */
  awarded: number;
  /** Per-skill breakdown, so the UI can float "+4 Data Science" on the section. */
  skills: { name: string; emoji: string | null; amount: number; leveledUp: boolean }[];
  /** The richest single award, for `celebrate()` to act on. */
  best?: AwardResult;
};

const EMPTY: BriefXpAward = { awarded: 0, skills: [] };

/**
 * Group article ids by the folder they live in.
 *
 * Articles with no folder are collected under a single null key rather than
 * dropped: they're real reading and they route to the default "Reading" skill,
 * which is what `awardXp` does with a folderless article anyway.
 */
async function groupByFolder(
  userId: string,
  articleIds: string[],
): Promise<Map<string | null, string[]>> {
  const out = new Map<string | null, string[]>();
  if (articleIds.length === 0) return out;

  const rows = await db
    .select({ id: articles.id, folderId: articles.folderId })
    .from(articles)
    .where(and(eq(articles.userId, userId), inArray(articles.id, articleIds)));

  for (const r of rows) {
    const key = r.folderId ?? null;
    const list = out.get(key);
    if (list) list.push(r.id);
    else out.set(key, [r.id]);
  }
  return out;
}

/**
 * Award one section's XP, split across the folders its articles came from.
 *
 * `articleIds` are the section's cited sources as the SERVER resolved them —
 * callers pass what the plan says the section covers, never what the client
 * claims it read.
 */
export async function awardBriefSection(
  userId: string,
  opts: { sectionKey: string; articleIds: string[]; date?: Date },
): Promise<BriefXpAward> {
  try {
    const day = dayKey(opts.date ?? new Date());
    const groups = await groupByFolder(userId, opts.articleIds);
    if (groups.size === 0) return EMPTY;

    const entries = [...groups.entries()];
    const amounts = splitXpByWeight(
      entries.map(([, ids]) => ids.length),
      XP_RULES.brief_read,
    );

    const results: AwardResult[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const [folderId, ids] = entries[i];
      const amount = amounts[i];
      if (amount <= 0) continue;
      results.push(
        await awardXp(userId, {
          source: "brief_read",
          amount,
          // Any member routes to the same folder skill; the first is as good as
          // any and keeps the grant deterministic.
          articleId: ids[0],
          refKind: SECTION_REF_KIND,
          // Folder in the key, so a section spanning three folders pays three
          // times — once each — and re-reading pays none of them again.
          refId: `${day}:${opts.sectionKey}:${folderId ?? "none"}`,
        }),
      );
    }

    return summarize(results);
  } catch (err) {
    // XP is a side effect. A failure here must never break reading the brief.
    console.warn("awardBriefSection failed:", err instanceof Error ? err.message : err);
    return EMPTY;
  }
}

/**
 * The completion bonus, once per day, split across the folders the whole
 * brief drew on — so finishing a brief that was mostly AI moves the AI skill
 * most.
 */
export async function awardBriefComplete(
  userId: string,
  opts: { articleIds: string[]; date?: Date },
): Promise<BriefXpAward> {
  try {
    const day = dayKey(opts.date ?? new Date());
    const groups = await groupByFolder(userId, opts.articleIds);
    if (groups.size === 0) return EMPTY;

    const entries = [...groups.entries()];
    const amounts = splitXpByWeight(
      entries.map(([, ids]) => ids.length),
      XP_RULES.brief_complete,
    );

    const results: AwardResult[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const [folderId, ids] = entries[i];
      if (amounts[i] <= 0) continue;
      results.push(
        await awardXp(userId, {
          source: "brief_complete",
          amount: amounts[i],
          articleId: ids[0],
          refKind: COMPLETE_REF_KIND,
          refId: `${day}:${folderId ?? "none"}`,
        }),
      );
    }
    return summarize(results);
  } catch (err) {
    console.warn("awardBriefComplete failed:", err instanceof Error ? err.message : err);
    return EMPTY;
  }
}

/**
 * Opening a source from the brief. Once per article ever — following the same
 * link tomorrow is not new engagement.
 */
export async function awardBriefSourceOpened(
  userId: string,
  articleId: string,
): Promise<BriefXpAward> {
  try {
    const result = await awardXp(userId, {
      source: "brief_source_opened",
      articleId,
      refKind: SOURCE_REF_KIND,
      refId: articleId,
    });
    return summarize([result]);
  } catch (err) {
    console.warn("awardBriefSourceOpened failed:", err instanceof Error ? err.message : err);
    return EMPTY;
  }
}

/** Collapse several awards into one payload for the client. */
function summarize(results: AwardResult[]): BriefXpAward {
  const skills = new Map<string, { name: string; emoji: string | null; amount: number; leveledUp: boolean }>();
  let awarded = 0;
  let best: AwardResult | undefined;

  for (const r of results) {
    if (r.awarded <= 0) continue;
    awarded += r.awarded;
    if (r.skill) {
      const existing = skills.get(r.skill.name);
      if (existing) {
        existing.amount += r.awarded;
        existing.leveledUp = existing.leveledUp || Boolean(r.skillLeveledUp);
      } else {
        skills.set(r.skill.name, {
          name: r.skill.name,
          emoji: r.skill.emoji,
          amount: r.awarded,
          leveledUp: Boolean(r.skillLeveledUp),
        });
      }
    }
    // Prefer whichever award carries a milestone worth celebrating over
    // whichever merely paid the most.
    const rank = (x: AwardResult) =>
      (x.rankUpTo ? 4 : 0) + (x.evolvedTo ? 3 : 0) + (x.playerLeveledUp ? 2 : 0) + (x.skillLeveledUp ? 1 : 0);
    if (!best || rank(r) > rank(best)) best = r;
  }

  return { awarded, skills: [...skills.values()].sort((a, b) => b.amount - a.amount), best };
}

/**
 * Consecutive days the user has finished the brief.
 *
 * Derived from the XP ledger rather than stored on the player profile: the
 * ledger already records exactly one `brief_complete` per day, so a stored
 * counter would be a second source of truth that could drift from it — and
 * would need a migration to add.
 */
export async function briefStreak(userId: string, today: Date = new Date()): Promise<number> {
  try {
    const rows = await db
      .select({ refId: xpEvents.refId })
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), eq(xpEvents.source, "brief_complete")))
      .limit(400);
    // refId is `${day}:${folderId}` — a completed brief writes one row per
    // folder, so the day has to be de-duplicated out of them.
    const days = new Set(rows.map((r) => (r.refId ?? "").split(":")[0]).filter(Boolean));
    return computeStreak(days, today);
  } catch {
    return 0;
  }
}

/** Folder names for a set of ids — used only to label the UI. */
export async function folderNames(userId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(eq(folders.userId, userId), inArray(folders.id, ids)));
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}

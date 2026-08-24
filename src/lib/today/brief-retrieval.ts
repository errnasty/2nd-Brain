/**
 * Choosing which articles a Daily Brief is built from.
 *
 * ## The problem this replaces
 *
 * The brief used to be "the newest N unread articles, trending first" — 50, 80
 * or 120 depending on depth — and everything past N simply did not exist as far
 * as the brief was concerned. That cap was never a judgement about how much is
 * worth reading; it was a memory and token budget. Which meant the budget was
 * being spent by whatever happened to sort highest, and a reader with busy
 * feeds could have a genuinely important story sitting at position 140 that no
 * brief would ever mention.
 *
 * Raising the number does not fix it, because the cost is in the wrong place:
 * every extra article carried an excerpt, a body fetch downstream, a desk
 * classification and a line in a prompt.
 *
 * ## The strategy: scan wide, select stories, hydrate narrow
 *
 * Three stages, each cheaper than it looks:
 *
 *   1. **Scan** — several hundred unread articles, TITLES ONLY. No excerpts, no
 *      bodies, no joins beyond the feed name. A scan row is ~150 bytes, so 800
 *      of them is a rounding error next to one article body.
 *   2. **Select** — collapse the scan into STORIES (the trending pass already
 *      clustered them), score the stories, and keep a bounded, diverse set of
 *      articles from the best ones. This is the only stage that makes a
 *      judgement, and it makes it about stories rather than articles — which is
 *      the unit the brief actually writes in.
 *   3. **Hydrate** — fetch excerpts (and later, bodies) for the selected set
 *      only.
 *
 * Peak memory is therefore set by the SELECTED set, not by how wide the scan
 * was. Widening the scan from 120 to 800 costs one bigger `select id, title`
 * and nothing else, so the brief can consider several times more of the queue
 * while the expensive part stays exactly where it was.
 *
 * ## Why the scoring walks a graph
 *
 * Ranking stories by heat alone reproduces the queue order and rediscovers the
 * same top-of-list stories the old cap already had. What it misses is the shape
 * of a day's news: a story is more worth briefing when it is part of something
 * — five separate pieces circling tariffs, three unconnected outlets all
 * reaching for "export controls" — than when it is an isolated one-off, even a
 * hot one.
 *
 * So the pool is treated as a graph: stories are nodes, shared distinctive
 * vocabulary is an edge, and each story's weighted degree in that graph feeds
 * its score. That is a genuine retrieval signal computed over the whole wide
 * scan, and it costs one pass over an inverted index rather than O(stories²)
 * comparisons — see `connectedness`.
 *
 * Pure: no db, no network, no clock except an injected `now`. The caller does
 * the I/O (see `brief-queue.ts`), which is what makes all of this testable.
 */

import { titleWords, representativeTitle } from "@/lib/trending/cluster";
import { BRIEF_TOPICS, OTHER_TOPIC_ID, classifyArticle, type BriefTopic } from "./topics";
import { trustedFeedCount } from "./feed-trust";

/** One row of the wide scan: everything selection needs, nothing it doesn't. */
export type ScanArticle = {
  id: string;
  title: string;
  feedId: string;
  feedTitle: string;
  publishDate: Date | null;
  /** 0 until the trending cron has scored it. */
  trendScore: number;
  /** The story this is one telling of; null when unscored or unique. */
  clusterId: string | null;
  wordCount: number | null;
  hasFullText: boolean;
};

/** A story as the selector sees it: every telling of one event, plus its shape. */
export type ScannedStory = {
  /** Cluster id, or a synthetic key for an unclustered article. */
  key: string;
  members: ScanArticle[];
  /** The cluster's most typical headline — what the story is "called". */
  title: string;
  /** DISTINCT feeds carrying it. The corroboration count. */
  distinctFeeds: number;
  deskId: string;
  score: number;
  /** Position of the first member in the scan — the deterministic tie-break. */
  order: number;
};

export type QueueSelection = {
  /** The articles the brief will number `[1..n]`, in final queue order. */
  selected: ScanArticle[];
  /** Distinct feeds per story, keyed by article id — the true source count for
   *  a story the per-story cap only let three tellings of through. */
  storyFeeds: Map<string, number>;
  /** What the scan saw against what the queue kept. Shown to the reader. */
  coverage: {
    scanned: number;
    stories: number;
    selectedStories: number;
    selected: number;
  };
  /** Stories the budget did not reach, by desk. */
  omitted: { topicId: string; stories: number; articles: number }[];
  /**
   * Cross-desk threads among the SELECTED stories — see `findThreads`. Refs are
   * 1-based positions in `selected`, one per story, so the brief can cite them
   * with the same `[n]` numbers as everything else.
   */
  threads: { terms: string[]; refs: number[]; deskIds: string[] }[];
};

// ── Tunables ────────────────────────────────────────────────────────────

/**
 * Tellings of one story kept in the queue.
 *
 * Matches `MAX_REFS_PER_STORY` in `brief-plan.ts` and for the same reason:
 * three establishes corroboration and lets a section notice that outlets are
 * framing it differently; a fourth is the same facts again. Applying it HERE as
 * well is what turns a wide scan into wide coverage — six syndicated copies of
 * one wire report used to consume six of the queue's slots before the planner
 * ever saw them.
 */
export const MAX_TELLINGS_PER_STORY = 3;

/**
 * Share of the queue any one desk may take while other desks still have
 * unselected stories. Lifted entirely on a second pass, so a reader whose
 * feeds really are all one subject still gets a full queue.
 */
const MAX_DESK_SHARE = 0.4;
/** …but never squeeze a desk below this, or the cap bites on a short queue. */
const MIN_DESK_SLOTS = 8;

/** Score weights. Trend leads; the graph term breaks ties towards live threads. */
const W_TREND = 3;
const W_CORROBORATION = 1.6;
const W_RECENCY = 1.2;
const W_FOLLOWED_DESK = 1.2;
const W_FEEDBACK = 0.6;
const W_GRAPH = 1;
const W_SUBSTANCE = 0.4;
/** Weighted above every inferred signal — see the note at its use site. */
const W_FOLLOWED_STORY = 6;

/** Distinct feeds at which corroboration is maxed — matches the trending pass. */
const CORROBORATION_SATURATION = 5;
/** Hours for a story's recency term to halve. */
const RECENCY_HALF_LIFE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The clock, rounded down to the hour.
 *
 * Selection has to return the SAME list to the plan call, to each of the eight
 * section calls that follow it, and to the XP call minutes later — those are
 * the `[n]` numbers every citation in the brief resolves against. Recency is
 * the one term here that moves continuously, so scoring against a raw `now`
 * would let two near-tied stories swap places between two requests seconds
 * apart and silently renumber the queue underneath a half-generated brief.
 *
 * Quantizing to the hour makes the score a step function: stable for every
 * request within the hour, and free to move at the boundary — which is where
 * the queue is expected to move anyway, since that is also the trending cron's
 * cadence, and the order fingerprint already exists to catch exactly that.
 */
function scoringClock(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
}

/** Shortest title word that can form a graph edge. Two-letter tokens are noise. */
const MIN_TERM_LENGTH = 3;
/**
 * A term shared by more stories than this is vocabulary, not a thread ("says",
 * "report", "new" survive the stop list in some phrasings). Counting it as an
 * edge to every one of them would make the graph term a popularity contest
 * over common words, so its contribution saturates.
 */
const MAX_SHARED_STORIES = 8;

/** Terms named per thread. Three is enough to say what it is about. */
const MAX_THREAD_TERMS = 3;

// ── Stage 2a: the scan, as stories ──────────────────────────────────────

/**
 * Collapse scan rows into stories. Articles the trending pass has not clustered
 * (a fresh database, the desktop app, anything published since the last run)
 * each become their own single-telling story, so selection behaves identically
 * whether or not clustering has happened yet — it just has less to merge.
 */
export function toStories(
  rows: ScanArticle[],
  desks: BriefTopic[] = BRIEF_TOPICS,
  /** Desks the reader has ruled out for a given headline — see `desk-suggest.ts`. */
  ruledOut?: (title: string, deskId: string) => boolean,
): ScannedStory[] {
  const byKey = new Map<string, ScanArticle[]>();
  const order = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = r.clusterId ?? `solo:${r.id}`;
    const existing = byKey.get(key);
    if (existing) existing.push(r);
    else {
      byKey.set(key, [r]);
      order.set(key, i);
    }
  });

  const stories: ScannedStory[] = [];
  for (const [key, members] of byKey) {
    const title = representativeTitle(members.map((m) => m.title));
    // Classified off the story's representative headline plus the lead
    // member's feed, so every telling lands on one desk by construction — the
    // same guarantee `groupByTopic`'s cluster vote provides downstream.
    // A desk the reader has said this story does not belong on is simply not
    // available to it. The correction takes effect on the next brief rather
    // than waiting to be confirmed by anything — a "wrong desk" tap that
    // changes nothing for a week reads as a button that does not work.
    const available = ruledOut ? desks.filter((d) => !ruledOut(title, d.id)) : desks;
    const deskId = classifyArticle({ title, feedTitle: members[0].feedTitle }, available);
    stories.push({
      key,
      members,
      title,
      distinctFeeds: new Set(members.map((m) => m.feedId)).size,
      deskId,
      score: 0,
      order: order.get(key) ?? 0,
    });
  }
  return stories;
}

// ── Stage 2b: the story graph ───────────────────────────────────────────

/**
 * Each story's weighted degree in the shared-vocabulary graph, normalized to
 * `[0, 1]`.
 *
 * Computed from an inverted index rather than by comparing every pair: a term
 * present in `df` stories contributes an edge to `df - 1` others, so summing
 * `idf(term) × (df - 1)` over a story's own terms IS its weighted degree. That
 * is one pass over the terms instead of O(stories²) set intersections, which
 * matters at the scan widths this exists to enable.
 *
 * Rare terms weigh more (idf), and a hub term's contribution saturates, so the
 * signal is "this story shares distinctive language with several others" rather
 * than "this story has a long headline".
 */
export function connectedness(stories: ScannedStory[]): number[] {
  const n = stories.length;
  if (n === 0) return [];

  const terms = stories.map((s) => [...new Set(titleWords(s.title))].filter((w) => w.length >= MIN_TERM_LENGTH));
  const df = new Map<string, number>();
  for (const list of terms) for (const t of list) df.set(t, (df.get(t) ?? 0) + 1);

  const raw = terms.map((list) => {
    let sum = 0;
    for (const t of list) {
      const d = df.get(t) ?? 1;
      if (d < 2) continue;
      const idf = Math.log(1 + n / d);
      sum += idf * Math.min(d - 1, MAX_SHARED_STORIES);
    }
    return sum;
  });

  const max = raw.reduce((m, v) => (v > m ? v : m), 0);
  return max > 0 ? raw.map((v) => v / max) : raw.map(() => 0);
}

/**
 * A thread: several stories, on more than one desk, circling the same thing.
 *
 * `connectedness` reduces the story graph to one number per story and throws
 * the edges away. The edges are the part a desk-by-desk brief structurally
 * cannot say: each desk sees only its own material, so five pieces about
 * tariffs spread across Markets, Policy and World Affairs get written up three
 * times as three unrelated developments, and the thing they have in common —
 * usually the actual story — is never stated by anyone.
 *
 * The cross-desk requirement is the whole definition. A term shared by four
 * stories on ONE desk is that desk's subject and its section already covers it;
 * the same term reaching across two desks is a connection nobody was in a
 * position to notice.
 */
export type StoryThread = {
  /** The shared terms, most distinctive first. What the thread is "about". */
  terms: string[];
  /** Indices into the story list the thread was found in. */
  stories: number[];
  /** Desks it spans. Always two or more. */
  deskIds: string[];
  /** Ranking weight: how much distinctive language, over how many stories. */
  weight: number;
};

/** Stories a term must appear in before it can be a thread rather than a coincidence. */
const MIN_THREAD_STORIES = 3;
/** Desks a thread must span. Two is the point; one is just a desk. */
const MIN_THREAD_DESKS = 2;
/**
 * A term in more than this share of the pool is house vocabulary, not a thread.
 * Guards against a reader whose feeds are all one subject finding a "thread"
 * called "ai" every single morning.
 */
const MAX_THREAD_SHARE = 0.5;

/**
 * Threads among a set of stories, strongest first.
 *
 * Terms covering the same set of stories are merged — "tariff", "tariffs" and
 * "semiconductor" over the same four stories are one thread with three names,
 * not three threads — and a story is used by at most one thread, so two threads
 * can never be the same observation twice.
 */
export function findThreads(stories: ScannedStory[], limit = 3): StoryThread[] {
  const n = stories.length;
  if (n < MIN_THREAD_STORIES) return [];

  const byTerm = new Map<string, number[]>();
  stories.forEach((s, i) => {
    for (const t of new Set(titleWords(s.title))) {
      if (t.length < MIN_TERM_LENGTH) continue;
      const list = byTerm.get(t);
      if (list) list.push(i);
      else byTerm.set(t, [i]);
    }
  });

  // Group terms by the exact set of stories they cover, so synonyms and
  // inflections of one subject collapse into a single thread.
  const bySignature = new Map<string, { terms: string[]; stories: number[] }>();
  for (const [term, idxs] of byTerm) {
    if (idxs.length < MIN_THREAD_STORIES || idxs.length > Math.max(MIN_THREAD_STORIES, n * MAX_THREAD_SHARE)) {
      continue;
    }
    const desks = new Set(idxs.map((i) => stories[i].deskId));
    if (desks.size < MIN_THREAD_DESKS) continue;
    const signature = idxs.join(",");
    const existing = bySignature.get(signature);
    if (existing) existing.terms.push(term);
    else bySignature.set(signature, { terms: [term], stories: idxs });
  }

  const candidates: StoryThread[] = [...bySignature.values()].map((g) => {
    const deskIds = [...new Set(g.stories.map((i) => stories[i].deskId))];
    const idf = Math.log(1 + n / g.stories.length);
    return {
      // Longer terms first: "semiconductor" names a thread better than "eu".
      terms: [...g.terms].sort((a, b) => b.length - a.length || a.localeCompare(b)),
      stories: [...g.stories].sort((a, b) => a - b),
      deskIds,
      weight: g.stories.length * idf * g.terms.length * deskIds.length,
    };
  });

  candidates.sort((a, b) =>
    b.weight !== a.weight ? b.weight - a.weight : a.stories[0] - b.stories[0],
  );

  const used = new Set<number>();
  const out: StoryThread[] = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    if (c.stories.some((i) => used.has(i))) continue;
    for (const i of c.stories) used.add(i);
    out.push(c);
  }
  return out;
}

/** Whether any telling has real text behind it, rather than a three-line stub. */
function hasSubstance(members: ScanArticle[]): boolean {
  return members.some((m) => m.hasFullText || (m.wordCount ?? 0) >= 800);
}

/** Newest telling, as an epoch ms. Undated stories are treated as current. */
function latestAt(members: ScanArticle[], at: number): number {
  let latest = 0;
  for (const m of members) {
    const t = m.publishDate ? m.publishDate.getTime() : at;
    if (t > latest) latest = t;
  }
  return latest || at;
}

/**
 * Score every story in place and return them ranked.
 *
 * Every term is `[0, 1]` before its weight, so the weights above are readable
 * as a blend rather than as arbitrary magnitudes. `trendScore` is already a
 * unit value from the trending pass; on a database where that pass has never
 * run it is uniformly 0 and the remaining terms — corroboration, recency, the
 * graph — rank the day on their own, which is exactly the degradation the rest
 * of the brief is built for.
 */
export function rankStories(
  stories: ScannedStory[],
  opts: {
    priority?: string[];
    deskWeights?: Record<string, number>;
    /** Per-feed multipliers — see `feed-trust.ts`. Absent feeds count as 1. */
    feedTrust?: Record<string, number>;
    /** Stories the reader asked to stay on — see `story-follow.ts`. */
    isFollowed?: (title: string) => boolean;
    now?: Date;
  } = {},
): ScannedStory[] {
  const at = scoringClock(opts.now ?? new Date());
  const followedDesks = new Set(opts.priority ?? []);
  const weights = opts.deskWeights ?? {};
  const trust = opts.feedTrust ?? {};
  const graph = connectedness(stories);

  stories.forEach((s, i) => {
    // Feeds counted by what they have earned rather than equally: three
    // outlets the reader actually reads agreeing on something outweighs four
    // they never open. With no history every feed is worth 1 and this is the
    // plain distinct-feed count it replaced.
    const corroboration =
      Math.min(trustedFeedCount(s.members.map((m) => m.feedId), trust), CORROBORATION_SATURATION) /
      CORROBORATION_SATURATION;
    const ageHours = Math.max(0, (at - latestAt(s.members, at)) / HOUR_MS);
    const recency = 0.5 ** (ageHours / RECENCY_HALF_LIFE_HOURS);
    const trend = s.members.reduce((m, a) => Math.max(m, a.trendScore ?? 0), 0);

    s.score =
      trend * W_TREND +
      corroboration * W_CORROBORATION +
      recency * W_RECENCY +
      (followedDesks.has(s.deskId) ? W_FOLLOWED_DESK : 0) +
      (weights[s.deskId] ?? 0) * W_FEEDBACK +
      graph[i] * W_GRAPH +
      (hasSubstance(s.members) ? W_SUBSTANCE : 0) +
      // A story the reader explicitly asked to stay on outranks everything
      // else here. This is the only signal in the file that is a request
      // rather than an inference, and it should behave like one.
      (opts.isFollowed?.(s.title) ? W_FOLLOWED_STORY : 0);
  });

  // Scan position is the tie-break, so two stories that score identically keep
  // the order the database gave them and the whole selection stays reproducible
  // across the plan call, every section call and the XP call.
  return [...stories].sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order));
}

/**
 * Which tellings of a story to keep, best first: a fetched body beats a stub,
 * a long piece beats a short one, and the hottest telling breaks the tie.
 */
function bestTellings(members: ScanArticle[], take: number): ScanArticle[] {
  return [...members]
    .sort((a, b) => {
      if (a.hasFullText !== b.hasFullText) return a.hasFullText ? -1 : 1;
      const wa = a.wordCount ?? 0;
      const wb = b.wordCount ?? 0;
      if (wa !== wb) return wb - wa;
      if (a.trendScore !== b.trendScore) return b.trendScore - a.trendScore;
      const pa = a.publishDate?.getTime() ?? 0;
      const pb = b.publishDate?.getTime() ?? 0;
      if (pa !== pb) return pb - pa;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, take);
}

// ── Stage 2c: selection ─────────────────────────────────────────────────

/**
 * The brief's queue: a bounded, desk-diverse set of articles drawn from a much
 * wider scan.
 *
 * Two passes. The first respects a per-desk ceiling, so a day where one desk
 * ran hot cannot spend the entire queue before any other desk is reached — the
 * failure that made a 120-article cap feel narrow even when it wasn't. The
 * second pass drops the ceiling and fills whatever budget is left in pure score
 * order, so a reader whose feeds genuinely are all one subject is not punished
 * with a short brief.
 *
 * Membership is decided by the two passes; ORDER is score order regardless of
 * which pass admitted a story, so the head of the queue is still the day's
 * biggest stories and every downstream cap (the lead's shortlist, a desk's
 * refs) keeps taking the best material first.
 */
export function selectBriefQueue(
  rows: ScanArticle[],
  opts: {
    limit: number;
    priority?: string[];
    deskWeights?: Record<string, number>;
    feedTrust?: Record<string, number>;
    isFollowed?: (title: string) => boolean;
    ruledOut?: (title: string, deskId: string) => boolean;
    desks?: BriefTopic[];
    perStory?: number;
    now?: Date;
  },
): QueueSelection {
  const limit = Math.max(0, opts.limit);
  const perStory = Math.max(1, opts.perStory ?? MAX_TELLINGS_PER_STORY);
  const stories = toStories(rows, opts.desks, opts.ruledOut);
  const ranked = rankStories(stories, opts);

  const deskCap = Math.max(MIN_DESK_SLOTS, Math.ceil(limit * MAX_DESK_SHARE));
  const usedByDesk = new Map<string, number>();
  const taken = new Map<string, ScanArticle[]>();
  let used = 0;

  const admit = (s: ScannedStory, capped: boolean): void => {
    if (used >= limit || taken.has(s.key)) return;
    const want = Math.min(perStory, s.members.length, limit - used);
    if (want <= 0) return;
    const deskUsed = usedByDesk.get(s.deskId) ?? 0;
    if (capped && deskUsed >= deskCap) return;
    const take = capped ? Math.min(want, deskCap - deskUsed) : want;
    if (take <= 0) return;
    taken.set(s.key, bestTellings(s.members, take));
    usedByDesk.set(s.deskId, deskUsed + take);
    used += take;
  };

  for (const s of ranked) admit(s, true);
  for (const s of ranked) admit(s, false);

  const selected: ScanArticle[] = [];
  const storyFeeds = new Map<string, number>();
  const selectedStories: ScannedStory[] = [];
  /** First `[n]` each story occupies — the ref a thread cites it by. */
  const firstRef: number[] = [];
  for (const s of ranked) {
    const members = taken.get(s.key);
    if (!members) continue;
    selectedStories.push(s);
    firstRef.push(selected.length + 1);
    for (const m of members) {
      selected.push(m);
      storyFeeds.set(m.id, s.distinctFeeds);
    }
  }

  // Threads are found over what was SELECTED, not over the whole scan: a
  // connection the brief cannot cite is a connection it cannot make.
  const threads = findThreads(selectedStories).map((t) => ({
    terms: t.terms.slice(0, MAX_THREAD_TERMS),
    refs: t.stories.map((i) => firstRef[i]).sort((a, b) => a - b),
    deskIds: t.deskIds,
  }));

  const omittedByDesk = new Map<string, { stories: number; articles: number }>();
  for (const s of ranked) {
    if (taken.has(s.key)) continue;
    const bucket = omittedByDesk.get(s.deskId) ?? { stories: 0, articles: 0 };
    bucket.stories += 1;
    bucket.articles += s.members.length;
    omittedByDesk.set(s.deskId, bucket);
  }

  return {
    selected,
    storyFeeds,
    threads,
    coverage: {
      scanned: rows.length,
      stories: stories.length,
      selectedStories: taken.size,
      selected: selected.length,
    },
    omitted: [...omittedByDesk.entries()]
      .map(([topicId, v]) => ({ topicId, ...v }))
      // "Also in your queue" last: it is the residue, not a desk anybody left out.
      .sort((a, b) =>
        a.topicId === OTHER_TOPIC_ID
          ? 1
          : b.topicId === OTHER_TOPIC_ID
            ? -1
            : b.stories - a.stories,
      ),
  };
}

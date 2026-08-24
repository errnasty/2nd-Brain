/**
 * Planning for a sectioned Daily Brief.
 *
 * ## Why the brief is split into sections
 *
 * Sectioning began as a workaround for a serverless host that killed a function
 * at ~10s, where one long "write me a detailed brief" generation rendered
 * nothing and left no partial result. Railway removes that ceiling, and the
 * sectioning stays anyway because it turned out to be the better design on its
 * own merits:
 *
 *   - Each section streams independently, so the reader has the lead in front
 *     of them while the desks are still being written. One long call shows
 *     nothing until it is finished.
 *   - A section that fails costs only that section and retries on its own.
 *   - Planning is deterministic — no model decides what the brief covers, so
 *     the same queue produces the same shape every morning.
 *
 * What DID change with the host is the size of each section: the per-section
 * token ceilings in `brief-prompts.ts` were a latency budget for that ~10s
 * window and have since been raised substantially.
 *
 * `refs` are 1-based positions in the article list, so every section cites the
 * same `[n]` numbers and the client can link them to one shared source map.
 * That list is itself a selection out of a much wider scan — see
 * `brief-retrieval.ts`; planning takes it as given.
 *
 * ## Why nothing appears twice
 *
 * A brief that covers one story in the lead and again on a desk has wasted the
 * reader's time twice over, and it was doing so through three separate routes.
 * All three are closed here:
 *
 *   - two tellings of one story classifying onto different desks — fixed by
 *     deciding the desk once per STORY (`groupByTopic`'s cluster vote);
 *   - a desk re-covering what the lead just wrote up — fixed by `covered`,
 *     which the client feeds back once the lead has streamed, since planning
 *     cannot know which of the lead's ten candidates it chose;
 *   - the quick-clear list offering back articles the brief already covered —
 *     fixed by building it from what nothing else claimed.
 *
 * Pure and client-safe: the Today tab uses this to render the section outline
 * before any generation starts.
 */

import {
  BRIEF_TOPICS,
  OTHER_TOPIC_ID,
  groupByTopic,
  topicLabel,
  type BriefTopic,
  type ClassifiableArticle,
  type CustomDesk,
} from "./topics";
import { continuingSince, matchRemembered, type RememberedStory } from "./story-memory";

export const BRIEF_LEVELS = ["concise", "standard", "deep"] as const;
export type BriefLevel = (typeof BRIEF_LEVELS)[number];
export const DEFAULT_BRIEF_LEVEL: BriefLevel = "standard";

export function isBriefLevel(v: unknown): v is BriefLevel {
  return typeof v === "string" && (BRIEF_LEVELS as readonly string[]).includes(v);
}

export type LevelConfig = {
  label: string;
  /** One line for the depth picker. */
  blurb: string;
  /**
   * How wide the title-only scan goes before selection — see
   * `brief-retrieval.ts`. This is how much of the queue the brief CONSIDERS.
   */
  scanLimit: number;
  /** How many articles survive selection and get `[n]` numbers. */
  articleLimit: number;
  /** Plain-text chars per article sent to a desk section. */
  bodyChars: number;
  /** Candidates offered to the lead section… */
  leadCandidates: number;
  /** …and how many of them it should actually write up. */
  leadPicks: number;
  /** Sentences of substance per lead item. */
  leadSentences: number;
  /** Whether lead items get a "Watch:" line. */
  leadWatch: boolean;
  /** Desk sections to generate. */
  maxTopics: number;
  /** Smallest bucket worth its own desk section. */
  minTopicSize: number;
  /** Articles sent to a single desk section (caps that call's input). */
  maxTopicRefs: number;
  /** Bullets requested per desk. */
  topicBullets: number;
  /** Desks get a "Tension:" line where sources cut against each other. */
  topicTension: boolean;
  /** Desks close with an unresolved question. */
  topicOpenQuestion: boolean;
  /** Include the catch-all desk for articles no desk claimed. */
  includeOther: boolean;
  /** Append the low-signal "Quick clear" list. */
  includeSkip: boolean;
  /** Big stories from outside the user's feeds. 0 = section omitted. */
  externalPicks: number;
  /** Cross-desk threads to draw out. 0 = section omitted. */
  threadPicks: number;
};

/**
 * Depth levels. The knobs that grow are per-section (more desks, longer
 * sections) — never "one bigger call", which is the thing the platform can't
 * do. `deep` is ~8 short requests; `concise` is 2.
 */
export const BRIEF_LEVEL_CONFIG: Record<BriefLevel, LevelConfig> = {
  concise: {
    label: "Concise",
    blurb: "The lead and a quick-clear list. Two short passes.",
    scanLimit: 250,
    articleLimit: 60,
    bodyChars: 700,
    leadCandidates: 8,
    leadPicks: 3,
    leadSentences: 2,
    leadWatch: false,
    maxTopics: 0,
    minTopicSize: 3,
    maxTopicRefs: 6,
    topicBullets: 3,
    topicTension: false,
    topicOpenQuestion: false,
    includeOther: false,
    includeSkip: true,
    externalPicks: 0,
    // Concise is the lead and a clear-out. A thread needs several stories on
    // several desks, and at this depth there are no desks.
    threadPicks: 0,
  },
  standard: {
    label: "Standard",
    blurb: "The lead, your five busiest desks, and what your feeds missed.",
    scanLimit: 500,
    articleLimit: 110,
    bodyChars: 900,
    leadCandidates: 10,
    leadPicks: 3,
    leadSentences: 3,
    leadWatch: false,
    maxTopics: 5,
    minTopicSize: 2,
    maxTopicRefs: 8,
    topicBullets: 4,
    topicTension: true,
    topicOpenQuestion: false,
    includeOther: false,
    includeSkip: true,
    externalPicks: 3,
    threadPicks: 2,
  },
  deep: {
    label: "Deep",
    blurb: "Every desk with a write-up, tensions and open questions.",
    scanLimit: 900,
    articleLimit: 180,
    bodyChars: 1300,
    leadCandidates: 12,
    // Three, not four: the lead's ceiling is a time budget (see
    // `sectionMaxTokens`), and a fourth item would come at the cost of the
    // depth each one gets.
    leadPicks: 3,
    leadSentences: 4,
    leadWatch: true,
    maxTopics: 8,
    minTopicSize: 1,
    maxTopicRefs: 12,
    topicBullets: 5,
    topicTension: true,
    topicOpenQuestion: true,
    includeOther: true,
    includeSkip: true,
    externalPicks: 5,
    threadPicks: 3,
  },
};

// ── How long the brief takes to read ────────────────────────────────────

/**
 * The depth levels are an author's abstraction: "concise", "standard", "deep"
 * describe how much work the brief does. Nobody opens a morning brief wanting
 * an amount of work — they open it with a number of minutes before the next
 * thing, and that is the question the picker should answer.
 *
 * So the levels stay exactly as they are internally (they are the knobs the
 * planner actually turns) and are PRESENTED as the reading time they produce.
 * The estimate is derived from the same knobs rather than written down beside
 * them, because a hardcoded "≈5 min" is a promise that quietly stops being
 * true the first time `topicBullets` is tuned, and nothing would catch it.
 */

/** Reading pace for dense prose. Matches the Feeds row's estimate. */
export const BRIEF_READING_WPM = 220;

/** A brief sentence, in words. Measured from generated sections, not guessed. */
const WORDS_PER_SENTENCE = 22;
/** The bold claim that opens each lead item. */
const LEAD_CLAIM_WORDS = 12;
/** "*Watch:* …" and "*Open question:* …" lines. */
const APPENDED_LINE_WORDS = 18;
/** A desk bullet is "one or two sentences" — call it one and a half. */
const BULLET_SENTENCES = 1.5;
/** A quick-clear entry: shortened title plus a reason of at most eight words. */
const SKIP_BULLET_WORDS = 14;
/**
 * Quick-clear entries in a typical brief. Not the queue size: the section is
 * told to be conservative and only list what is genuinely skippable, so it
 * runs to a handful of lines however long the queue is.
 */
const TYPICAL_SKIP_ITEMS = 6;

/** What the brief will actually contain, when it is known. */
export type BriefShape = {
  /** Desk sections generated. Defaults to the level's ceiling. */
  topics?: number;
  /** External stories offered. Defaults to the level's ceiling. */
  externals?: number;
};

/** Words the brief is expected to run to at this level. */
export function estimateBriefWords(level: BriefLevel, shape: BriefShape = {}): number {
  const cfg = BRIEF_LEVEL_CONFIG[level];
  const topics = shape.topics ?? cfg.maxTopics;
  const externals = shape.externals ?? cfg.externalPicks;

  const lead =
    cfg.leadPicks *
    (LEAD_CLAIM_WORDS +
      cfg.leadSentences * WORDS_PER_SENTENCE +
      (cfg.leadWatch ? APPENDED_LINE_WORDS : 0));

  const perTopic =
    WORDS_PER_SENTENCE +
    cfg.topicBullets * BULLET_SENTENCES * WORDS_PER_SENTENCE +
    (cfg.topicTension ? WORDS_PER_SENTENCE : 0) +
    (cfg.topicOpenQuestion ? APPENDED_LINE_WORDS : 0);

  const skip = cfg.includeSkip ? TYPICAL_SKIP_ITEMS * SKIP_BULLET_WORDS : 0;
  const external = externals > 0 ? LEAD_CLAIM_WORDS + externals * BULLET_SENTENCES * WORDS_PER_SENTENCE : 0;

  return Math.round(lead + topics * perTopic + skip + external);
}

/**
 * Minutes the brief is expected to take. Rounded to whole minutes and never
 * below one — "≈0 min" reads as a bug, and a brief with any content at all
 * takes a moment.
 */
export function estimateBriefMinutes(level: BriefLevel, shape: BriefShape = {}): number {
  return Math.max(1, Math.round(estimateBriefWords(level, shape) / BRIEF_READING_WPM));
}

export type SectionKind = "lead" | "topic" | "skip" | "external" | "threads";

/**
 * Refs that are the same real-world story, told by different outlets.
 *
 * Carried on the section (rather than left for the model to notice) because it
 * is known deterministically: the trending pass already clustered the queue, so
 * the brief can simply be TOLD that [3], [7] and [12] are one story. That turns
 * six syndicated copies of a wire report from six wasted slots into one item
 * citing six sources — which is most of where the brief's new depth comes from.
 */
export type StoryGroup = {
  refs: number[];
  /** Distinct feeds carrying it. */
  sourceCount: number;
};

/** A big story from outside the user's feeds, cited as `[E1]`, `[E2]`, … */
export type ExternalRef = {
  n: number;
  title: string;
  outlet: string | null;
  url: string;
  topicId: string | null;
  sourceCount: number;
};

/** A ref whose story the brief has covered before. */
export type ContinuingRef = {
  ref: number;
  /** How long ago it was first briefed, in words: "yesterday", "3 days ago". */
  since: string;
};

export type PlannedSection = {
  /** Stable id the client sends back to generate this one section. */
  key: string;
  kind: SectionKind;
  topicId?: string;
  /** Heading the brief renders for this section. */
  label: string;
  /** The `[n]` numbers this section may cite. */
  refs: number[];
  /** Multi-source stories among this section's refs. Only groups of 2+. */
  stories?: StoryGroup[];
  /** Refs the reader has already been briefed on — report the change, not the
   *  background. Only on sections that write prose about a story. */
  continuing?: ContinuingRef[];
  /** External stories, for the "you're missing" section only. */
  externals?: ExternalRef[];
  /** Cross-desk threads, for the "threads" section only. */
  threads?: PlannedThread[];
};

/** One thread the brief is asked to explain, as the section receives it. */
export type PlannedThread = {
  /** The shared vocabulary. What the thread is "about", before anyone writes it. */
  terms: string[];
  refs: number[];
  /** Names of the desks it crosses — the reason this is worth a section. */
  deskLabels: string[];
};

export type BriefPlan = {
  level: BriefLevel;
  sections: PlannedSection[];
  /** Every desk found in the queue, including ones this level left out. */
  desks: { topicId: string; label: string; count: number; included: boolean }[];
};

/** What planning needs to know about an article beyond its text. */
export type PlanArticle = ClassifiableArticle & {
  wordCount?: number | null;
  /** Whether the full article body was fetched — a proxy for substance. */
  hasFullText?: boolean;
  /** From the trending pass; 0 when unscored. */
  trendScore?: number | null;
  /** The story cluster this article belongs to, when it has one. */
  clusterId?: string | null;
  /**
   * Distinct feeds carrying this article's story across the whole scan.
   *
   * Not the same as "how many of its tellings are in the queue": retrieval
   * keeps at most three, so a wire report six outlets ran arrives as three
   * refs. The brief should still be able to say six — that spread is most of
   * why the story matters — so the true count rides along with the article.
   */
  storyFeeds?: number | null;
};

/** An external story as the planner receives it, before `[E n]` numbering. */
export type ExternalCandidate = {
  title: string;
  url: string;
  outlet?: string | null;
  topicId?: string | null;
  sourceCount?: number;
  volume?: number;
};

const LEAD_SECTION_LABEL = "The lead";
const SKIP_SECTION_LABEL = "Quick clear";
const EXTERNAL_SECTION_LABEL = "Outside your feeds";
const THREADS_SECTION_LABEL = "Threads";

/**
 * Group a set of refs by the story cluster they belong to, keeping only groups
 * with more than one telling — a single-source story needs no annotation.
 * Ordered by the first ref so the prompt reads in `[n]` order.
 */
export function storyGroupsFor(items: PlanArticle[], refs: number[]): StoryGroup[] {
  const byCluster = new Map<string, number[]>();
  for (const ref of refs) {
    const item = items[ref - 1];
    const id = item?.clusterId;
    if (!id) continue;
    const existing = byCluster.get(id);
    if (existing) existing.push(ref);
    else byCluster.set(id, [ref]);
  }
  return [...byCluster.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sorted = [...group].sort((a, b) => a - b);
      // The true spread when retrieval measured it, never less than the refs
      // in hand — an under-count would be a claim the citation itself refutes.
      const feeds = items[sorted[0] - 1]?.storyFeeds ?? 0;
      return { refs: sorted, sourceCount: Math.max(sorted.length, feeds) };
    })
    .sort((a, b) => a.refs[0] - b.refs[0]);
}

/**
 * Which of a section's refs the brief has covered before.
 *
 * One entry per REF rather than per story: the section prompt cites refs, so
 * telling it "[3] — you were briefed on this yesterday" is directly actionable,
 * where naming the story would leave it to work out which number that was.
 *
 * A story first briefed today is deliberately absent (`continuingSince`
 * returns null under a day). It's in the memory because this morning's brief
 * put it there, and claiming continuity with a brief the reader is currently
 * reading would be nonsense.
 */
export function continuingRefs(
  items: PlanArticle[],
  refs: number[],
  memory: RememberedStory[],
  now: Date = new Date(),
): ContinuingRef[] {
  if (memory.length === 0) return [];
  const out: ContinuingRef[] = [];
  for (const ref of refs) {
    const item = items[ref - 1];
    if (!item) continue;
    const remembered = matchRemembered(item.title, memory);
    if (!remembered) continue;
    const since = continuingSince(remembered, now);
    if (since) out.push({ ref, since });
  }
  return out;
}

/** Rough substance signal: a fetched 2000-word essay outranks a 3-line stub. */
function substanceScore(a: PlanArticle): number {
  const words = a.wordCount ?? 0;
  if (words >= 1200) return 2;
  if (words >= 400) return 1;
  if (words > 0) return 0;
  // No word count (most RSS items) — fall back to how much text we have.
  return (a.excerpt ?? "").length >= 400 ? 1 : 0;
}

/**
 * Which articles the lead section gets to choose between. The model picks the
 * final items; this only narrows the candidate set so one call stays small.
 *
 * Preference order: how hot the story is, then the desks the user cares about,
 * then articles with real body text behind them, then the newest. Returned in
 * ascending `[n]` order so the numbering in the prompt reads naturally.
 *
 * Candidates are deduplicated by story cluster: offering the lead ten articles
 * that are really three stories wastes most of the slate and invites the model
 * to write the same item twice. One telling per story goes forward — the best
 * one — and the section prompt is separately told which other refs cover it, so
 * nothing is lost from the citation.
 */
export function leadCandidateRefs(
  items: PlanArticle[],
  opts: {
    priority?: string[];
    count: number;
    deskWeights?: Record<string, number>;
    desks?: BriefTopic[];
  },
): number[] {
  const priority = new Set(opts.priority ?? []);
  const weights = opts.deskWeights ?? {};
  const buckets = groupByTopic(items, {
    desks: opts.desks,
    clusterIds: items.map((a) => a.clusterId),
  });
  const topicOf = new Map<number, string>();
  for (const b of buckets) for (const ref of b.refs) topicOf.set(ref, b.topicId);

  const scored = items.map((a, i) => {
    const ref = i + 1;
    const topicId = topicOf.get(ref) ?? "";
    const onPriorityDesk = priority.has(topicId);
    // Recency is a tie-breaker, not a driver: items arrive newest-first, so a
    // shrinking bonus down the list keeps today ahead of last week.
    const recency = items.length > 1 ? (1 - i / (items.length - 1)) * 1.5 : 1.5;
    return {
      ref,
      clusterId: a.clusterId ?? null,
      score:
        // Weighted to outrank every other signal combined: a story six outlets
        // covered in two hours belongs in the lead even if it arrived as a
        // short wire stub on a desk the user never picked.
        (a.trendScore ?? 0) * 8 +
        (onPriorityDesk ? 3 : 0) +
        // Sits below the followed-desk bonus on purpose. Feedback should be
        // able to break a tie between two comparable candidates, not overrule
        // a desk the reader explicitly asked to lead.
        (weights[topicId] ?? 0) * 2 +
        (a.hasFullText ? 2 : 0) +
        substanceScore(a) +
        recency,
    };
  });

  const ranked = scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.ref - b.ref,
  );

  const seenClusters = new Set<string>();
  const picked: number[] = [];
  for (const item of ranked) {
    if (picked.length >= Math.max(0, opts.count)) break;
    if (item.clusterId) {
      if (seenClusters.has(item.clusterId)) continue;
      seenClusters.add(item.clusterId);
    }
    picked.push(item.ref);
  }

  return picked.sort((a, b) => a - b);
}

/**
 * Tellings of one story that a single desk section will be shown. Three is
 * enough to establish corroboration and to let the model notice that outlets
 * are framing it differently; past that it's the same facts again.
 */
export const MAX_REFS_PER_STORY = 3;

/**
 * A desk's refs, capped for one model call.
 *
 * Capping by ARTICLE alone is what made the old brief thin: a desk with eight
 * slots and one wire story syndicated six times covered two developments and
 * called it a day. Capping tellings-per-story instead spends those eight slots
 * on five or six distinct developments, which is the same call size and far
 * more of the queue actually accounted for.
 *
 * Refs arrive in queue order, which is trending order, so what survives the cap
 * is the desk's hottest material rather than merely its newest.
 */
export function deskRefs(items: PlanArticle[], refs: number[], maxRefs: number): number[] {
  const perCluster = new Map<string, number>();
  const out: number[] = [];
  for (const ref of refs) {
    if (out.length >= maxRefs) break;
    const clusterId = items[ref - 1]?.clusterId;
    if (clusterId) {
      const used = perCluster.get(clusterId) ?? 0;
      if (used >= MAX_REFS_PER_STORY) continue;
      perCluster.set(clusterId, used + 1);
    }
    out.push(ref);
  }
  return out;
}

/**
 * Refs that must not be written up again, expanded to whole stories.
 *
 * The lead is generated first and alone, and what it actually chose is only
 * known once it has been written — planning offers it ten candidates and it
 * picks three. So the refs it cited come BACK from the client and every later
 * section is planned without them.
 *
 * Expansion to the cluster is the part that matters. A lead item citing [3] has
 * covered the story, not the telling: leaving [7] and [12] on a desk would
 * reproduce exactly the duplication this exists to remove, one syndication hop
 * away from where it was noticed.
 */
export function coveredRefs(items: PlanArticle[], refs: number[] | undefined): Set<number> {
  const out = new Set<number>();
  if (!refs || refs.length === 0) return out;
  const clusters = new Set<string>();
  for (const ref of refs) {
    if (!Number.isInteger(ref) || ref < 1 || ref > items.length) continue;
    out.add(ref);
    const id = items[ref - 1]?.clusterId;
    if (id) clusters.add(id);
  }
  if (clusters.size > 0) {
    items.forEach((a, i) => {
      if (a.clusterId && clusters.has(a.clusterId)) out.add(i + 1);
    });
  }
  return out;
}

/**
 * Titles the quick-clear list is shown.
 *
 * Everything the brief has already written up is removed first, which is the
 * whole point: an article covered in the lead or on a desk is not a candidate
 * for "you can mark this read without opening it" — it has just been read
 * ABOUT. Listing it again was the most visible duplication in the brief,
 * because it put the same story in front of the reader twice under two
 * opposite framings.
 *
 * What is left is then capped. Quick clear is a list of headlines, so it used
 * to scale with the whole queue; at the scan widths the brief now works at,
 * uncapped it would quietly become the longest section in the document.
 */
const MAX_SKIP_REFS = 60;

function skipRefs(total: number, written: Set<number>): number[] {
  const out: number[] = [];
  for (let ref = 1; ref <= total && out.length < MAX_SKIP_REFS; ref += 1) {
    if (!written.has(ref)) out.push(ref);
  }
  return out;
}

/**
 * Build the section plan for a queue. No model, no network — this runs on every
 * Today load so the page can show the outline (and the desk counts) instantly,
 * then fill each section in.
 */
export function planBrief(
  items: PlanArticle[],
  opts: {
    level?: BriefLevel;
    priority?: string[];
    externals?: ExternalCandidate[];
    /** Stories previous briefs covered, for the continuity markers. */
    memory?: RememberedStory[];
    /** Desk verdicts, in [-1, 1]. See `brief-feedback.ts`. */
    deskWeights?: Record<string, number>;
    /** The reader's full desk list — their own desks plus the built-ins. */
    desks?: BriefTopic[];
    /** Refs an earlier section already wrote up. See `coveredRefs`. */
    covered?: number[];
    /** Cross-desk threads found during retrieval — see `brief-retrieval.ts`. */
    threads?: { terms: string[]; refs: number[]; deskIds: string[] }[];
    now?: Date;
  } = {},
): BriefPlan {
  const level = opts.level ?? DEFAULT_BRIEF_LEVEL;
  const cfg = BRIEF_LEVEL_CONFIG[level];
  const priority = opts.priority ?? [];
  const memory = opts.memory ?? [];
  const weights = opts.deskWeights ?? {};
  const desks = opts.desks ?? BRIEF_TOPICS;
  const now = opts.now ?? new Date();

  if (items.length === 0) return { level, sections: [], desks: [] };

  const covered = coveredRefs(items, opts.covered);

  const leadRefs = leadCandidateRefs(items, {
    priority,
    count: cfg.leadCandidates,
    deskWeights: weights,
    desks,
  });
  const sections: PlannedSection[] = [
    {
      key: "lead",
      kind: "lead",
      label: LEAD_SECTION_LABEL,
      refs: leadRefs,
      // The lead's candidates are already one-per-story, so its groups tell the
      // model which OTHER refs corroborate each candidate — that's what lets a
      // lead item cite six outlets while only one of them was offered.
      stories: storyGroupsFor(items, items.map((_, i) => i + 1)).filter((g) =>
        g.refs.some((r) => leadRefs.includes(r)),
      ),
      continuing: continuingRefs(items, leadRefs, memory, now),
    },
  ];

  // Cluster ids go in so every telling of one story lands on ONE desk. Without
  // it the same event could be written up under two headings, each citing half
  // the outlets, because two outlets phrased the headline differently enough to
  // classify apart.
  const buckets = groupByTopic(items, {
    priority,
    desks,
    clusterIds: items.map((a) => a.clusterId),
  });
  const eligible = buckets.filter(
    (b) =>
      b.refs.length >= cfg.minTopicSize && (b.topicId !== OTHER_TOPIC_ID || cfg.includeOther),
  );
  // Verdicts reorder the desks competing for the level's slots. Only the SIGN
  // is used, and the sort is stable, so a desk the reader asked for more of
  // moves ahead of the neutral ones while everything inside a group keeps the
  // order it already earned on priority and size. Using the magnitude here
  // would let a fortnight of clicks rebuild the desk order from scratch, which
  // is a bigger claim than a thumbs-up makes.
  const ranked = [...eligible].sort(
    (a, b) => Math.sign(weights[b.topicId] ?? 0) - Math.sign(weights[a.topicId] ?? 0),
  );
  const chosen = ranked.slice(0, cfg.maxTopics);
  const chosenIds = new Set(chosen.map((b) => b.topicId));

  // Everything the brief writes up, so the quick-clear list can be told what is
  // already dealt with rather than offering it back as skippable.
  const writtenUp = new Set<number>(covered);

  for (const b of chosen) {
    // Covered refs come off BEFORE the cap, not after, so a desk whose top
    // story went to the lead backfills with its next story instead of losing
    // the slot. Dedup and coverage turn out to be the same edit.
    const available = covered.size > 0 ? b.refs.filter((r) => !covered.has(r)) : b.refs;
    const refs = deskRefs(items, available, cfg.maxTopicRefs);
    // A desk the lead emptied keeps its section, with no refs.
    //
    // Dropping it here instead is tempting and wrong: the plan the client
    // renders is built WITHOUT `covered` (the lead has not been written yet),
    // so the client already holds a block for this desk and will ask for it by
    // key. A planner that then denies the key turns a desk with nothing left to
    // say into a section that fails to load. Keeping it means the two plans
    // always have the same shape, and "nothing left" is answered in the
    // protocol — see the empty-section short-circuit in the route.
    for (const r of refs) writtenUp.add(r);
    sections.push({
      key: `topic:${b.topicId}`,
      kind: "topic",
      topicId: b.topicId,
      label: b.label,
      refs,
      stories: storyGroupsFor(items, refs),
      continuing: continuingRefs(items, refs, memory, now),
    });
  }

  // Threads go BEFORE the quick-clear list and after the desks, because that is
  // where they make sense: they are about material the reader has just read,
  // and they are the last thing in the brief that is actually reading.
  const threads = (opts.threads ?? [])
    .filter((t) => t.refs.length >= 2)
    .slice(0, cfg.threadPicks);
  if (cfg.threadPicks > 0 && threads.length > 0) {
    sections.push({
      key: "threads",
      kind: "threads",
      label: THREADS_SECTION_LABEL,
      // Deliberately NOT filtered by `covered`, and deliberately not added to
      // `writtenUp`. Every ref here has been covered already — that is the
      // precondition, not a bug. The section's job is the line between them,
      // which is the one thing a desk-by-desk brief can never say, and it is
      // told in its prompt not to retell the stories themselves.
      refs: [...new Set(threads.flatMap((t) => t.refs))].sort((a, b) => a - b),
      threads: threads.map((t) => ({
        terms: t.terms,
        refs: t.refs,
        deskLabels: t.deskIds.map((id) => topicLabel(id, desks)),
      })),
    });
  }

  if (cfg.includeSkip) {
    const refs = skipRefs(items.length, writtenUp);
    sections.push({
      key: "skip",
      kind: "skip",
      label: SKIP_SECTION_LABEL,
      // Titles only, and only what no other section covered — so the section
      // stays one small call and can never repeat the brief back at the reader.
      refs,
      // Duplicate coverage is the most common reason an item is skippable, and
      // it's the one thing the model can't see from titles alone.
      stories: storyGroupsFor(items, refs),
    });
  }

  const externals = (opts.externals ?? []).slice(0, cfg.externalPicks);
  if (cfg.externalPicks > 0 && externals.length > 0) {
    sections.push({
      key: "external",
      kind: "external",
      label: EXTERNAL_SECTION_LABEL,
      // Externals have their own `[E n]` numbering: they are not in the user's
      // queue, so they must never claim an `[n]` that resolves to an article.
      refs: [],
      externals: externals.map((e, i) => ({
        n: i + 1,
        title: e.title,
        outlet: e.outlet ?? null,
        url: e.url,
        topicId: e.topicId ?? null,
        sourceCount: e.sourceCount ?? 1,
      })),
    });
  }

  return {
    level,
    sections,
    desks: buckets.map((b) => ({
      topicId: b.topicId,
      label: b.label,
      count: b.refs.length,
      included: chosenIds.has(b.topicId),
    })),
  };
}

/** Look a section up in a plan by the key the client sent. */
export function findSection(plan: BriefPlan, key: string): PlannedSection | null {
  return plan.sections.find((s) => s.key === key) ?? null;
}

/**
 * Identity of the *settings* a stored brief was generated under. Paired with
 * the unread-set fingerprint, this is what tells us a stored brief no longer
 * matches what the user has asked for (they switched to Deep, or changed which
 * desks they follow) and should be regenerated.
 */
export function briefSettingsKey(
  level: BriefLevel,
  priority: string[],
  customDesks: CustomDesk[] = [],
  instructions: string = "",
): string {
  // Custom desks change the shape of the brief as directly as the depth level
  // does — a new desk is a new section — so editing one has to invalidate a
  // stored brief the same way switching to Deep does. Terms are included, not
  // just ids: retuning a desk's keywords changes what it claims.
  const custom = customDesks
    .map((d) => `${d.id}:${d.keywords.join("|")}`)
    .sort()
    .join(";");
  // Standing instructions are part of the brief's identity for the same reason:
  // rewriting them changes every section, so a brief written under the old ones
  // is no longer the brief the reader is asking for.
  return `sectioned/v1/${level}/${[...priority].join(",")}${custom ? `/${custom}` : ""}${
    instructions ? `/${instructions}` : ""
  }`;
}


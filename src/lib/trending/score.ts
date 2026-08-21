/**
 * How hot a story is, right now.
 *
 * ## What "trending" means here
 *
 * Not "recent". The Feeds tab already had a sort called "Hot" that was nothing
 * but a three-day recency filter — every story published this morning ranked
 * identically, which is the same as no ranking at all.
 *
 * A story is trending when *independent outlets converge on it fast*. That
 * gives three measurable parts:
 *
 *   1. **Corroboration** — how many DISTINCT feeds carried it. This is the
 *      backbone, and the reason the count is of feeds rather than articles: a
 *      single outlet posting five follow-ups must not be able to manufacture a
 *      trend. It's superlinear, because five outlets agreeing something matters
 *      is far more than five times one outlet saying so.
 *   2. **Velocity** — how fast those tellings arrived, measured against how
 *      long the story has been running. A story picking up six outlets in two
 *      hours is breaking; six over four days is a slow burn.
 *   3. **Decay** — everything ages out, on a half-life, so yesterday's
 *      genuinely big story yields to today's.
 *
 * Those three are computed entirely from the user's own feeds. Two further
 * signals are blended on top: **external heat** (what the wider world is
 * publishing about it — see `sources/`) and **personal relevance** (how close
 * it sits to the desks the user follows and the notes they've written).
 *
 * ## Why this file is pure
 *
 * Every function here is pure arithmetic over plain values: no db, no network,
 * no clock except an injected `now`. That makes the whole scoring model
 * unit-testable and, more importantly, *tunable* — the weights are the product
 * decision, and they're all in one place at the top of the file rather than
 * scattered through the query that happens to use them. Same reasoning as
 * `src/lib/gamify/rules.ts`.
 */

// ── Tunables ────────────────────────────────────────────────────────────

/**
 * Blend of the three score families. Corroboration leads because it's the only
 * one grounded in evidence the user themselves subscribed to; external heat is
 * a strong but borrowed signal; personal relevance breaks ties towards the
 * things this particular reader cares about rather than reordering wholesale.
 */
export const SCORE_WEIGHTS = {
  corroboration: 0.5,
  external: 0.3,
  personal: 0.2,
} as const;

/**
 * Superlinear exponent on the distinct-feed count. At 1.5, going 1 → 2 sources
 * roughly triples the term while 5 → 6 adds ~30%: the jump from "one outlet
 * says so" to "two independently say so" is the most informative step there is,
 * and it should dominate.
 */
export const CORROBORATION_EXPONENT = 1.5;

/**
 * Distinct-feed count at which corroboration is considered maxed out.
 *
 * Calibrated to a PERSONAL feed list, not a newsroom wire. Saturating at 8 was
 * wrong in practice: a typical list carries 3–5 outlets on even the day's
 * biggest story, so the backbone term never got past ~0.5 and the borrowed
 * signals below decided the ranking instead. Five distinct outlets a reader
 * chose themselves converging on one story IS that reader's top story.
 */
export const CORROBORATION_SATURATION = 5;

/**
 * Distinct feeds at which external heat is trusted at full strength, and the
 * fraction of it a single-source story may claim.
 *
 * External heat is a BORROWED signal: it says the wider world is publishing
 * about these words, not that this story is real news in this library. Left
 * ungated it was the bug behind "trending shows me mundane articles" — one
 * feed's throwaway post that happened to contain a hot term scored the full
 * external weight (0.3) and beat a genuinely corroborated three-outlet story
 * (~0.23), because nothing tied the borrowed signal to any evidence.
 *
 * So external heat now scales with how much corroboration stands behind it. It
 * amplifies evidence rather than substituting for it, which is exactly the
 * asymmetry the clustering threshold is already built around.
 */
export const EXTERNAL_EVIDENCE_SATURATION = 4;
export const EXTERNAL_EVIDENCE_FLOOR = 0.2;

/** Hours for a story's freshness to halve. */
export const DECAY_HALF_LIFE_HOURS = 8;

/**
 * Sources/hour treated as a full-strength burst. Six outlets inside an hour is
 * a genuine wire-level event; the curve saturates there so a freak spike can't
 * run away with the ranking.
 */
export const VELOCITY_SATURATION = 6;

/**
 * Floor on the velocity multiplier. A story that accumulated its sources
 * slowly is still a real story — velocity modulates the score, it doesn't gate
 * it. Range ends up [0.6, 1.4].
 */
export const VELOCITY_FLOOR = 0.6;
export const VELOCITY_CEILING = 1.4;

/** Bonus for a story that a followed desk claims (see `topics.ts`). */
export const FOLLOWED_DESK_BONUS = 0.35;

/**
 * A story older than this is not "trending" whatever else it has going.
 *
 * Aligned with `WINDOW_HOURS` in `compute.ts`, which reads a 48-hour window.
 * At 72 this was unreachable dead config: a cluster's `lastSeen` can never be
 * older than the window it was built from, so the guard never fired and the
 * number implied a policy the code did not have. It stays as an explicit floor
 * for callers that score a cluster from somewhere other than the cron pass.
 */
export const MAX_STORY_AGE_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

/** Clamp to [0, 1]. */
function unit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Corroboration, normalized to 0–1.
 *
 * `distinctFeeds` MUST be a count of feeds, not articles — passing an article
 * count here is the one mistake that breaks the model, because it hands any
 * high-volume outlet a way to fake consensus with itself.
 */
export function corroborationScore(distinctFeeds: number): number {
  const n = Math.max(0, distinctFeeds);
  if (n <= 1) return n === 1 ? unit(1 / CORROBORATION_SATURATION ** CORROBORATION_EXPONENT) : 0;
  return unit(n ** CORROBORATION_EXPONENT / CORROBORATION_SATURATION ** CORROBORATION_EXPONENT);
}

/**
 * How much of the external-heat weight a story with this many distinct feeds
 * is allowed to claim, in [EXTERNAL_EVIDENCE_FLOOR, 1].
 *
 * A singleton keeps a fifth of it — enough that a hot single-source story can
 * still surface above cold ones, nowhere near enough to top a corroborated
 * story on keywords alone.
 */
export function evidenceConfidence(distinctFeeds: number): number {
  const n = Math.max(0, distinctFeeds);
  if (n === 0) return 0;
  const t = unit(n / EXTERNAL_EVIDENCE_SATURATION);
  return EXTERNAL_EVIDENCE_FLOOR + t * (1 - EXTERNAL_EVIDENCE_FLOOR);
}

/**
 * Sources per hour since the story first appeared, as a multiplier in
 * [VELOCITY_FLOOR, VELOCITY_CEILING].
 *
 * The age floor of one hour matters: without it, a story whose first two
 * tellings land in the same minute divides by ~0 and reports an infinite rate,
 * so every brand-new item would outrank everything else purely for being new.
 */
export function velocityMultiplier(distinctFeeds: number, ageHours: number): number {
  const age = Math.max(1, ageHours);
  const rate = Math.max(0, distinctFeeds) / age;
  const t = unit(rate / VELOCITY_SATURATION);
  return VELOCITY_FLOOR + t * (VELOCITY_CEILING - VELOCITY_FLOOR);
}

/** Exponential freshness decay on DECAY_HALF_LIFE_HOURS. */
export function recencyDecay(ageHours: number): number {
  const age = Math.max(0, ageHours);
  return unit(0.5 ** (age / DECAY_HALF_LIFE_HOURS));
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

export type ClusterSignals = {
  /** Distinct FEEDS covering the story. */
  distinctFeeds: number;
  /** When the story first appeared in the user's feeds. */
  firstSeen: Date;
  /** The most recent telling — what recency decays from. */
  lastSeen: Date;
  /** External heat, 0–1 (see `externalHeat`). */
  externalVolume?: number;
  /** Similarity to the user's own material, 0–1. */
  personalScore?: number;
  /** Whether the story's desk is one the user follows. */
  onFollowedDesk?: boolean;
};

export type ScoredCluster = {
  score: number;
  velocity: number;
  corroboration: number;
  decay: number;
};

/**
 * The blended trend score for one story cluster, in 0–1.
 *
 * Recency decay multiplies the *whole* blend rather than being another
 * weighted term, because staleness isn't a competing consideration — a
 * four-day-old story with wall-to-wall coverage still isn't trending, and no
 * amount of external heat should be able to buy its way past that.
 */
export function scoreCluster(signals: ClusterSignals, now: Date = new Date()): ScoredCluster {
  const ageHours = hoursBetween(signals.lastSeen, now);
  const spanHours = hoursBetween(signals.firstSeen, signals.lastSeen);

  const corroboration = corroborationScore(signals.distinctFeeds);
  const velocity = velocityMultiplier(signals.distinctFeeds, spanHours);
  const decay = ageHours > MAX_STORY_AGE_HOURS ? 0 : recencyDecay(ageHours);

  // External heat is gated on corroboration; personal relevance is not. The
  // difference is whose evidence it is — the wider world's coverage is only
  // meaningful once this library has independently seen the story, whereas
  // "this is close to what you write about" is true of a single article on its
  // own merits. Personal is also capped low enough (0.2) that it can only ever
  // break ties, never lead the list.
  const blended =
    SCORE_WEIGHTS.corroboration * corroboration * velocity +
    SCORE_WEIGHTS.external *
      unit(signals.externalVolume ?? 0) *
      evidenceConfidence(signals.distinctFeeds) +
    SCORE_WEIGHTS.personal * unit(signals.personalScore ?? 0);

  const followed = signals.onFollowedDesk ? 1 + FOLLOWED_DESK_BONUS : 1;

  return {
    score: unit(blended * decay * followed),
    velocity,
    corroboration,
    decay,
  };
}

// ── External heat ───────────────────────────────────────────────────────

/**
 * Public signals report in wildly different units — GDELT in article counts,
 * Hacker News in points, Google News in rank position. Comparing them
 * unnormalized would let whichever source happens to use the biggest numbers
 * decide the ranking, so each is squashed into 0–1 *within its own source*
 * before anything is blended.
 *
 * Log scaling, because all of these are heavy-tailed: the gap between 10 and
 * 100 mentions carries far more meaning than 1000 versus 1090.
 */
export function normalizeVolume(value: number, saturation: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (saturation <= 1) return unit(value);
  return unit(Math.log1p(value) / Math.log1p(saturation));
}

export type TermMatch = { term: string; weight: number };

/**
 * External heat for a story: how strongly its text matches the trending terms
 * harvested from public signals.
 *
 * Diminishing returns across matches (rather than a sum) so that a headline
 * stuffed with common trending words can't out-score a story that matches the
 * single term everyone is actually talking about.
 */
export function externalHeat(matches: TermMatch[]): number {
  if (matches.length === 0) return 0;
  const sorted = [...matches].sort((a, b) => b.weight - a.weight);
  let heat = 0;
  let falloff = 1;
  for (const m of sorted) {
    heat += unit(m.weight) * falloff;
    falloff *= 0.5;
  }
  return unit(heat);
}

/**
 * Personal relevance in 0–1, blending the desks the user follows with how
 * close the story sits to their own notes and cards.
 *
 * `similarity` is a raw cosine, which for text embeddings sits around 0.3 even
 * for unrelated pairs — so it's rebased on a floor and rescaled, otherwise
 * every story would arrive with a free ~0.3 of "relevance".
 */
export const PERSONAL_SIMILARITY_FLOOR = 0.35;

export function personalRelevance(opts: {
  similarity?: number;
  onFollowedDesk?: boolean;
  starredInCluster?: boolean;
}): number {
  const raw = opts.similarity ?? 0;
  const rebased =
    raw <= PERSONAL_SIMILARITY_FLOOR
      ? 0
      : (raw - PERSONAL_SIMILARITY_FLOOR) / (1 - PERSONAL_SIMILARITY_FLOOR);
  return unit(
    0.6 * unit(rebased) + (opts.onFollowedDesk ? 0.25 : 0) + (opts.starredInCluster ? 0.15 : 0),
  );
}

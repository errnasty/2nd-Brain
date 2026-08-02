/**
 * The character sheet's stat block.
 *
 * Five stats, each DERIVED from what you have actually done — never awarded,
 * never spent, never chosen. That is the whole point: a stat block that can be
 * bought or allocated is a fiction, while one computed from your real history
 * is a readout of how you have been studying. Two people with the same total
 * XP but different habits get visibly different characters.
 *
 * Pure and dependency-free so the curve can be unit-tested and tuned in one
 * place, the same way `rules.ts` and `levels.ts` are.
 */

/** Counter bag from `player_profile.counters` (see SOURCE_COUNTER in rules.ts). */
export type StatCounters = Record<string, number>;

export type StatKey = "INT" | "MEM" | "GRT" | "PRC" | "CRF";

export type StatDef = {
  key: StatKey;
  /** Full name, for the non-pixel rendering and tooltips. */
  name: string;
  /** One line explaining what raises it — a stat you can't explain is noise. */
  hint: string;
};

export const STAT_DEFS: StatDef[] = [
  { key: "INT", name: "Intellect", hint: "Ideas taken in — concepts, articles and briefs read" },
  { key: "MEM", name: "Memory", hint: "Retrieval practice — flashcards graded" },
  { key: "GRT", name: "Grit", hint: "Turning up — streak days, daily goals and sessions finished" },
  { key: "PRC", name: "Precision", hint: "Being marked right — quizzes completed" },
  { key: "CRF", name: "Craft", hint: "Output — notes written, documents added, items distilled, tasks done" },
];

/**
 * What feeds each stat, and how heavily.
 *
 * Weights are relative effort, not importance: grading one card is a smaller
 * act than finishing a whole brief, so a brief counts for more of a point. The
 * weighting mirrors the XP economy's judgement in `rules.ts` — retrieval and
 * output are worth more than consumption — so the sheet cannot tell a
 * different story about you than your XP does.
 */
const CONTRIBUTIONS: Record<StatKey, { counter: string; weight: number }[]> = {
  INT: [
    { counter: "conceptsLearned", weight: 1 },
    { counter: "articlesRead", weight: 0.5 },
    { counter: "briefsRead", weight: 4 },
  ],
  MEM: [{ counter: "cardsGraded", weight: 1 }],
  GRT: [
    { counter: "goalsHit", weight: 3 },
    { counter: "sessionsDone", weight: 3 },
  ],
  PRC: [{ counter: "quizzesCompleted", weight: 4 }],
  CRF: [
    { counter: "notesCreated", weight: 2 },
    { counter: "docsUploaded", weight: 2 },
    { counter: "distills", weight: 2 },
    { counter: "tasksDone", weight: 1 },
  ],
};

/** Streak days feed Grit directly rather than through a counter — the streak
 *  lives on the player row, and a long CURRENT streak says more about turning
 *  up than the total number of goals ever hit. */
const STREAK_WEIGHT = 2;

export const STAT_MAX = 99;

/**
 * Raw weighted activity → a 1-99 stat.
 *
 * Logarithmic on purpose. Counters are unbounded and grow forever, so a linear
 * map would either pin everyone at 1 for months or run off the end within a
 * year. A log curve moves fast at the start (the first few cards visibly do
 * something), then slows, so the difference between 900 and 1000 cards is
 * small — which is honest, because it is.
 */
export function curve(points: number): number {
  if (points <= 0) return 1;
  const scaled = 16 * Math.log10(1 + points / 2.2);
  return Math.max(1, Math.min(STAT_MAX, Math.round(scaled)));
}

export type Stat = StatDef & {
  value: number;
  /** Raw weighted points behind `value` — shown on hover, and what makes the
   *  number auditable rather than magic. */
  points: number;
};

export function computeStats(counters: StatCounters, streakDays = 0): Stat[] {
  return STAT_DEFS.map((def) => {
    let points = 0;
    for (const { counter, weight } of CONTRIBUTIONS[def.key]) {
      points += Math.max(0, counters[counter] ?? 0) * weight;
    }
    if (def.key === "GRT") points += Math.max(0, streakDays) * STREAK_WEIGHT;
    return { ...def, points: Math.round(points), value: curve(points) };
  });
}

/**
 * The stat a character leans on most — their "class" in everything but name.
 *
 * Ties break by STAT_DEFS order rather than arbitrarily, so a brand-new
 * character (all stats 1) reads as Intellect instead of flickering between
 * five equal stats on every render.
 */
export function dominantStat(stats: Stat[]): Stat | null {
  if (stats.length === 0) return null;
  return stats.reduce((best, s) => (s.value > best.value ? s : best), stats[0]);
}

/**
 * A title for the character, from their strongest stat and player level.
 *
 * Deliberately NOT the rank title in `levels.ts` — that answers "how far have
 * you come", and this answers "what kind of studier are you". Shown together
 * they say more than either does alone.
 */
const ARCHETYPES: Record<StatKey, [string, string, string]> = {
  //        early           mid              late
  INT: ["Reader", "Scholar", "Polymath"],
  MEM: ["Rememberer", "Mnemonist", "Archivist"],
  GRT: ["Regular", "Steadfast", "Unbroken"],
  PRC: ["Tested", "Marksman", "Unerring"],
  CRF: ["Note-taker", "Craftsman", "Architect"],
};

export function archetype(stats: Stat[], playerLevel: number): string {
  const top = dominantStat(stats);
  if (!top || top.value <= 1) return "Wanderer";
  const band = playerLevel >= 25 ? 2 : playerLevel >= 10 ? 1 : 0;
  return ARCHETYPES[top.key][band];
}

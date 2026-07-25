// Pure leveling + tier/rarity curves. No db / runtime deps so it's unit-tested
// and reusable anywhere (server engine + client HUD). Tunable in one place.

export type LevelInfo = {
  level: number;
  /** XP accumulated inside the current level. */
  intoLevel: number;
  /** Total XP the current level spans (intoLevel + remaining). */
  span: number;
  /** XP remaining to reach the next level. */
  toNext: number;
};

const MAX_LEVEL = 999;

/** Generic XP→level resolver given a per-level cost function. */
function resolve(xp: number, costForLevel: (level: number) => number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL) {
    const need = costForLevel(level);
    if (remaining < need) {
      return { level, intoLevel: remaining, span: need, toNext: need - remaining };
    }
    remaining -= need;
    level += 1;
  }
  const need = costForLevel(MAX_LEVEL);
  return { level: MAX_LEVEL, intoLevel: need, span: need, toNext: 0 };
}

// ── Curves ──────────────────────────────────────────────────────────────
//
// Both curves PLATEAU: the per-level cost climbs, then caps, so late levels
// stay a steady grind instead of turning into walls. The old uncapped curves
// put player Lv10 at 7,200 XP (~2 months of daily goals) and a skill's Master
// tier at ~24,000 XP — milestones nobody would ever actually see. Now:
//
//   player  Lv5 ≈ 550 XP   Lv10 ≈ 1,800   Lv25 ≈ 9,300   Lv50 ≈ 26,800
//   skill   Lv3 ≈ 92 XP    Lv7  ≈ 456     Lv12 ≈ 1,090   Lv30 ≈ 5,416
//
// At a ~150 XP day that's the first tier bump inside one session, a rare skill
// within a couple of weeks, and legendary/mythic tiers inside a few months.
const SKILL_BASE = 40;
const SKILL_STEP = 12;
const SKILL_CAP = 260;
const PLAYER_BASE = 100;
const PLAYER_STEP = 25;
const PLAYER_CAP = 700;

const skillCost = (level: number) => Math.min(SKILL_BASE + SKILL_STEP * (level - 1), SKILL_CAP);
const playerCost = (level: number) => Math.min(PLAYER_BASE + PLAYER_STEP * (level - 1), PLAYER_CAP);

export function skillLevelFromXp(xp: number): LevelInfo {
  return resolve(xp, skillCost);
}

export function playerLevelFromXp(xp: number): LevelInfo {
  return resolve(xp, playerCost);
}

/** Total XP needed to sit exactly at the start of `level` (for tier teasers). */
export function xpForSkillLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.max(1, level); l += 1) total += skillCost(l);
  return total;
}

// ── Tiers / rarity (skill evolutions) ───────────────────────────────────

export type Tier = {
  name: string;
  rarity: string;
  /** Solid accent — text, bars, borders. */
  color: string;
  /** Gradient stops for badges, rings and fills. */
  from: string;
  to: string;
  /** Legendary and up get an outer glow / shimmer treatment in the HUD. */
  glow: boolean;
  minLevel: number;
};

// Ordered low→high. A skill "evolves" when it crosses into the next tier.
// Boundaries are front-loaded on purpose: the first two evolutions arrive fast
// (they're the ones that teach you the system exists), then they space out.
export const TIERS: Tier[] = [
  { name: "Novice", rarity: "Common", color: "#94a3b8", from: "#cbd5e1", to: "#64748b", glow: false, minLevel: 1 },
  { name: "Apprentice", rarity: "Uncommon", color: "#22c55e", from: "#4ade80", to: "#15803d", glow: false, minLevel: 3 },
  { name: "Adept", rarity: "Rare", color: "#3b82f6", from: "#60a5fa", to: "#1d4ed8", glow: false, minLevel: 7 },
  { name: "Expert", rarity: "Epic", color: "#a855f7", from: "#c084fc", to: "#7e22ce", glow: false, minLevel: 12 },
  { name: "Virtuoso", rarity: "Legendary", color: "#f59e0b", from: "#fcd34d", to: "#d97706", glow: true, minLevel: 20 },
  { name: "Master", rarity: "Mythic", color: "#ec4899", from: "#f472b6", to: "#be185d", glow: true, minLevel: 30 },
  { name: "Grandmaster", rarity: "Radiant", color: "#06b6d4", from: "#67e8f9", to: "#0e7490", glow: true, minLevel: 42 },
  { name: "Paragon", rarity: "Celestial", color: "#f43f5e", from: "#38bdf8", to: "#f43f5e", glow: true, minLevel: 60 },
];

export function tierForLevel(level: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (level >= t.minLevel) tier = t;
    else break;
  }
  return tier;
}

/** The tier above `level`, or null once the top tier is reached. */
export function nextTier(level: number): Tier | null {
  return TIERS.find((t) => t.minLevel > level) ?? null;
}

/** True when `from`→`to` crosses a tier boundary (an evolution happened). */
export function evolved(fromLevel: number, toLevel: number): Tier | null {
  const a = tierForLevel(fromLevel);
  const b = tierForLevel(toLevel);
  return a.name !== b.name ? b : null;
}

// ── Player rank titles ──────────────────────────────────────────────────

export type Rank = {
  title: string;
  color: string;
  from: string;
  to: string;
  /** High ranks get an aura around the level medallion. */
  glow: boolean;
  minLevel: number;
};

// Ordered low→high. Unlike tiers these are the *player* ladder — one identity
// that spans every skill — so the early steps are cheap and frequent.
export const RANKS: Rank[] = [
  { title: "Curious", color: "#94a3b8", from: "#cbd5e1", to: "#64748b", glow: false, minLevel: 1 },
  { title: "Learner", color: "#22c55e", from: "#4ade80", to: "#15803d", glow: false, minLevel: 4 },
  { title: "Student", color: "#14b8a6", from: "#5eead4", to: "#0f766e", glow: false, minLevel: 8 },
  { title: "Scholar", color: "#3b82f6", from: "#60a5fa", to: "#1d4ed8", glow: false, minLevel: 12 },
  { title: "Analyst", color: "#6366f1", from: "#818cf8", to: "#4338ca", glow: false, minLevel: 17 },
  { title: "Specialist", color: "#a855f7", from: "#c084fc", to: "#7e22ce", glow: false, minLevel: 22 },
  { title: "Sage", color: "#d946ef", from: "#e879f9", to: "#a21caf", glow: true, minLevel: 28 },
  { title: "Polymath", color: "#f59e0b", from: "#fcd34d", to: "#d97706", glow: true, minLevel: 35 },
  { title: "Luminary", color: "#f97316", from: "#fdba74", to: "#c2410c", glow: true, minLevel: 45 },
  { title: "Oracle", color: "#ec4899", from: "#f9a8d4", to: "#be185d", glow: true, minLevel: 60 },
  { title: "Archon", color: "#06b6d4", from: "#67e8f9", to: "#0e7490", glow: true, minLevel: 80 },
  { title: "Ascendant", color: "#f43f5e", from: "#38bdf8", to: "#f43f5e", glow: true, minLevel: 100 },
];

export function rankForLevel(playerLevel: number): Rank {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (playerLevel >= r.minLevel) rank = r;
    else break;
  }
  return rank;
}

/** The rank above `playerLevel`, or null at the top of the ladder. */
export function nextRank(playerLevel: number): Rank | null {
  return RANKS.find((r) => r.minLevel > playerLevel) ?? null;
}

/** A flavor title for a player level. */
export function rankTitle(playerLevel: number): string {
  return rankForLevel(playerLevel).title;
}

/** True when `from`→`to` promotes the player into a new rank. */
export function promoted(fromLevel: number, toLevel: number): Rank | null {
  const a = rankForLevel(fromLevel);
  const b = rankForLevel(toLevel);
  return a.title !== b.title ? b : null;
}

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

// Skill curve: gentle early (fast, fun), scales up. L1→2 = 60, +40 each level.
const skillCost = (level: number) => 60 + 40 * (level - 1);
// Player curve: coarser, since every skill feeds it. L1→2 = 200, +150 each.
const playerCost = (level: number) => 200 + 150 * (level - 1);

export function skillLevelFromXp(xp: number): LevelInfo {
  return resolve(xp, skillCost);
}

export function playerLevelFromXp(xp: number): LevelInfo {
  return resolve(xp, playerCost);
}

// ── Tiers / rarity (evolutions) ─────────────────────────────────────────

export type Tier = { name: string; rarity: string; color: string; minLevel: number };

// Ordered low→high. A skill "evolves" when it crosses into the next tier.
export const TIERS: Tier[] = [
  { name: "Novice", rarity: "Common", color: "#9ca3af", minLevel: 1 },
  { name: "Apprentice", rarity: "Uncommon", color: "#22c55e", minLevel: 5 },
  { name: "Adept", rarity: "Rare", color: "#3b82f6", minLevel: 10 },
  { name: "Expert", rarity: "Epic", color: "#a855f7", minLevel: 20 },
  { name: "Master", rarity: "Legendary", color: "#f59e0b", minLevel: 35 },
  { name: "Grandmaster", rarity: "Mythic", color: "#ec4899", minLevel: 50 },
];

export function tierForLevel(level: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (level >= t.minLevel) tier = t;
    else break;
  }
  return tier;
}

/** True when `from`→`to` crosses a tier boundary (an evolution happened). */
export function evolved(fromLevel: number, toLevel: number): Tier | null {
  const a = tierForLevel(fromLevel);
  const b = tierForLevel(toLevel);
  return a.name !== b.name ? b : null;
}

// ── Player rank titles ──────────────────────────────────────────────────

const RANKS = [
  "Curious", "Learner", "Student", "Scholar", "Analyst",
  "Specialist", "Sage", "Polymath", "Luminary", "Oracle",
];

/** A flavor title for a player level (every 5 levels bumps the rank). */
export function rankTitle(playerLevel: number): string {
  const idx = Math.min(RANKS.length - 1, Math.floor((playerLevel - 1) / 5));
  return RANKS[Math.max(0, idx)];
}

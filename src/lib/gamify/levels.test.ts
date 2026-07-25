import { describe, expect, it } from "vitest";
import {
  skillLevelFromXp,
  playerLevelFromXp,
  xpForSkillLevel,
  tierForLevel,
  nextTier,
  evolved,
  rankTitle,
  rankForLevel,
  nextRank,
  promoted,
  TIERS,
  RANKS,
} from "./levels";

describe("skillLevelFromXp", () => {
  it("starts at level 1 with 0 xp", () => {
    const r = skillLevelFromXp(0);
    expect(r.level).toBe(1);
    expect(r.intoLevel).toBe(0);
    expect(r.span).toBe(40); // first level costs 40
    expect(r.toNext).toBe(40);
  });

  it("stays level 1 just below the threshold, levels at the threshold", () => {
    expect(skillLevelFromXp(39).level).toBe(1);
    expect(skillLevelFromXp(40).level).toBe(2);
  });

  it("accumulates across multiple levels (40 then 52)", () => {
    // L1→2 = 40, L2→3 = 52. 92 total → exactly level 3.
    const r = skillLevelFromXp(92);
    expect(r.level).toBe(3);
    expect(r.intoLevel).toBe(0);
  });

  it("reports progress within a level", () => {
    const r = skillLevelFromXp(60); // 40 used to hit L2, 20 into L2 (span 52)
    expect(r.level).toBe(2);
    expect(r.intoLevel).toBe(20);
    expect(r.span).toBe(52);
    expect(r.toNext).toBe(32);
  });

  it("plateaus: the per-level cost caps instead of growing forever", () => {
    const a = skillLevelFromXp(xpForSkillLevel(40)).span;
    const b = skillLevelFromXp(xpForSkillLevel(80)).span;
    expect(a).toBe(260);
    expect(b).toBe(260);
  });

  it("is monotonic in level", () => {
    let last = 0;
    for (let xp = 0; xp < 5000; xp += 137) {
      const lvl = skillLevelFromXp(xp).level;
      expect(lvl).toBeGreaterThanOrEqual(last);
      last = lvl;
    }
  });

  it("clamps negative/garbage xp to level 1", () => {
    expect(skillLevelFromXp(-50).level).toBe(1);
  });
});

describe("xpForSkillLevel", () => {
  it("agrees with the resolver", () => {
    for (const lvl of [1, 3, 7, 12, 20, 30]) {
      expect(skillLevelFromXp(xpForSkillLevel(lvl)).level).toBe(lvl);
      expect(skillLevelFromXp(xpForSkillLevel(lvl)).intoLevel).toBe(0);
    }
  });
});

describe("playerLevelFromXp", () => {
  it("needs more xp than a skill for the same level", () => {
    expect(playerLevelFromXp(40).level).toBe(1); // 40 levels a skill, not a player
    expect(playerLevelFromXp(100).level).toBe(2);
  });

  it("keeps the early game brisk — level 5 inside a few days of daily goals", () => {
    // 100 + 125 + 150 + 175 = 550 XP to reach level 5.
    expect(playerLevelFromXp(549).level).toBe(4);
    expect(playerLevelFromXp(550).level).toBe(5);
  });
});

describe("tiers / evolution", () => {
  it("maps levels to the right tier", () => {
    expect(tierForLevel(1).name).toBe("Novice");
    expect(tierForLevel(2).name).toBe("Novice");
    expect(tierForLevel(3).name).toBe("Apprentice");
    expect(tierForLevel(7).name).toBe("Adept");
    expect(tierForLevel(12).name).toBe("Expert");
    expect(tierForLevel(20).name).toBe("Virtuoso");
    expect(tierForLevel(30).name).toBe("Master");
    expect(tierForLevel(42).name).toBe("Grandmaster");
    expect(tierForLevel(60).name).toBe("Paragon");
    expect(tierForLevel(999).name).toBe("Paragon");
  });

  it("detects an evolution only when crossing a boundary", () => {
    expect(evolved(2, 3)?.name).toBe("Apprentice");
    expect(evolved(1, 2)).toBeNull(); // same tier
    expect(evolved(6, 7)?.name).toBe("Adept");
    expect(evolved(7, 9)).toBeNull();
  });

  it("nextTier points at the upcoming milestone and stops at the top", () => {
    expect(nextTier(1)?.name).toBe("Apprentice");
    expect(nextTier(20)?.name).toBe("Master");
    expect(nextTier(60)).toBeNull();
  });

  it("every tier has a distinct ascending boundary and full styling", () => {
    for (let i = 1; i < TIERS.length; i += 1) {
      expect(TIERS[i].minLevel).toBeGreaterThan(TIERS[i - 1].minLevel);
    }
    for (const t of TIERS) {
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.from).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.to).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.rarity).toBeTruthy();
    }
  });

  it("keeps the top tiers reachable, not decorative", () => {
    // Master used to sit at ~24k XP in one skill. It should be a season's work,
    // not a lifetime's.
    expect(xpForSkillLevel(30)).toBeLessThan(8000);
  });
});

describe("ranks", () => {
  it("returns a title and climbs with level", () => {
    expect(rankTitle(1)).toBe("Curious");
    expect(rankTitle(4)).toBe("Learner");
    expect(rankTitle(12)).toBe("Scholar");
    expect(typeof rankTitle(999)).toBe("string");
  });

  it("promotes only when crossing a rank boundary", () => {
    expect(promoted(3, 4)?.title).toBe("Learner");
    expect(promoted(4, 5)).toBeNull();
  });

  it("nextRank points ahead and stops at the top", () => {
    expect(nextRank(1)?.title).toBe("Learner");
    expect(nextRank(100)).toBeNull();
  });

  it("every rank has a distinct ascending boundary and full styling", () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      expect(RANKS[i].minLevel).toBeGreaterThan(RANKS[i - 1].minLevel);
    }
    for (const r of RANKS) {
      expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(rankForLevel(r.minLevel).title).toBe(r.title);
    }
  });
});

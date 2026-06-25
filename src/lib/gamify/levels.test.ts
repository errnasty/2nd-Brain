import { describe, expect, it } from "vitest";
import {
  skillLevelFromXp,
  playerLevelFromXp,
  tierForLevel,
  evolved,
  rankTitle,
  TIERS,
} from "./levels";

describe("skillLevelFromXp", () => {
  it("starts at level 1 with 0 xp", () => {
    const r = skillLevelFromXp(0);
    expect(r.level).toBe(1);
    expect(r.intoLevel).toBe(0);
    expect(r.span).toBe(60); // first level costs 60
    expect(r.toNext).toBe(60);
  });

  it("stays level 1 just below the threshold, levels at the threshold", () => {
    expect(skillLevelFromXp(59).level).toBe(1);
    expect(skillLevelFromXp(60).level).toBe(2);
  });

  it("accumulates across multiple levels (60 then 100)", () => {
    // L1→2 = 60, L2→3 = 100. 160 total → exactly level 3.
    const r = skillLevelFromXp(160);
    expect(r.level).toBe(3);
    expect(r.intoLevel).toBe(0);
  });

  it("reports progress within a level", () => {
    const r = skillLevelFromXp(80); // 60 used to hit L2, 20 into L2 (span 100)
    expect(r.level).toBe(2);
    expect(r.intoLevel).toBe(20);
    expect(r.span).toBe(100);
    expect(r.toNext).toBe(80);
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

describe("playerLevelFromXp", () => {
  it("needs more xp than a skill for the same level", () => {
    expect(playerLevelFromXp(60).level).toBe(1); // 60 levels a skill, not a player
    expect(playerLevelFromXp(200).level).toBe(2);
  });
});

describe("tiers / evolution", () => {
  it("maps levels to the right tier", () => {
    expect(tierForLevel(1).name).toBe("Novice");
    expect(tierForLevel(4).name).toBe("Novice");
    expect(tierForLevel(5).name).toBe("Apprentice");
    expect(tierForLevel(10).name).toBe("Adept");
    expect(tierForLevel(20).name).toBe("Expert");
    expect(tierForLevel(35).name).toBe("Master");
    expect(tierForLevel(50).name).toBe("Grandmaster");
    expect(tierForLevel(999).name).toBe("Grandmaster");
  });

  it("detects an evolution only when crossing a boundary", () => {
    expect(evolved(4, 5)?.name).toBe("Apprentice");
    expect(evolved(1, 4)).toBeNull(); // same tier
    expect(evolved(9, 10)?.name).toBe("Adept");
    expect(evolved(10, 12)).toBeNull();
  });

  it("every tier has a distinct ascending boundary", () => {
    for (let i = 1; i < TIERS.length; i += 1) {
      expect(TIERS[i].minLevel).toBeGreaterThan(TIERS[i - 1].minLevel);
    }
  });
});

describe("rankTitle", () => {
  it("returns a title and bumps every 5 levels", () => {
    expect(rankTitle(1)).toBe("Curious");
    expect(rankTitle(6)).toBe("Learner");
    expect(typeof rankTitle(999)).toBe("string");
  });
});

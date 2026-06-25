import { describe, expect, it } from "vitest";
import { newlyUnlocked, achievementByKey, ACHIEVEMENTS, type AchievementSnapshot } from "./achievements";

const base: AchievementSnapshot = {
  totalXp: 0,
  playerLevel: 1,
  streakDays: 0,
  maxSkillLevel: 1,
  skillCount: 0,
  counters: {},
};

describe("newlyUnlocked", () => {
  it("unlocks first_xp once any XP is earned", () => {
    expect(newlyUnlocked({ ...base, totalXp: 1 }, [])).toContain("first_xp");
  });

  it("does not re-unlock something already held", () => {
    const got = newlyUnlocked({ ...base, totalXp: 1 }, ["first_xp"]);
    expect(got).not.toContain("first_xp");
  });

  it("unlocks counter-based achievements at the threshold", () => {
    expect(newlyUnlocked({ ...base, counters: { cardsGraded: 50 } }, [])).toContain("cards_50");
    expect(newlyUnlocked({ ...base, counters: { cardsGraded: 49 } }, [])).not.toContain("cards_50");
  });

  it("unlocks skill + streak milestones", () => {
    expect(newlyUnlocked({ ...base, maxSkillLevel: 35 }, [])).toEqual(
      expect.arrayContaining(["skill_adept", "skill_master"]),
    );
    expect(newlyUnlocked({ ...base, streakDays: 7 }, [])).toContain("streak_7");
  });

  it("returns multiple new keys at once and all are real", () => {
    const snap: AchievementSnapshot = {
      totalXp: 9999,
      playerLevel: 10,
      streakDays: 30,
      maxSkillLevel: 35,
      skillCount: 5,
      counters: { cardsGraded: 100, tasksDone: 25, articlesRead: 50, notesCreated: 25 },
    };
    const keys = newlyUnlocked(snap, []);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(achievementByKey(k)).toBeDefined();
  });

  it("has unique keys across all definitions", () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// Read model for the gamified Study dashboard. Pulls the player aggregate,
// skills, recent XP feed, and achievement state in a few cheap queries.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playerProfile, skills, xpEvents } from "@/lib/db/schema";
import { playerLevelFromXp, skillLevelFromXp, tierForLevel, rankTitle } from "./levels";
import { DAILY_GOAL, SOURCE_LABEL, type XpSource } from "./rules";
import { ACHIEVEMENTS } from "./achievements";

export type GameSkill = {
  id: string;
  name: string;
  emoji: string | null;
  domain: string;
  xp: number;
  level: number;
  intoLevel: number;
  span: number;
  tier: string;
  rarity: string;
  color: string;
};

export type GamePlayer = {
  level: number;
  totalXp: number;
  intoLevel: number;
  span: number;
  rank: string;
  streakDays: number;
  dailyXp: number;
  dailyGoal: number;
};

export type GameFeedEntry = { id: string; amount: number; label: string; skill: string | null; at: string };

export type GameAchievement = { key: string; name: string; desc: string; emoji: string; unlocked: boolean; at: string | null };

export type GameState = {
  player: GamePlayer;
  skills: GameSkill[];
  recent: GameFeedEntry[];
  achievements: GameAchievement[];
};

const EMPTY_PLAYER: GamePlayer = {
  level: 1, totalXp: 0, intoLevel: 0, span: playerLevelFromXp(0).span, rank: rankTitle(1),
  streakDays: 0, dailyXp: 0, dailyGoal: DAILY_GOAL,
};

export async function fetchGameState(userId: string): Promise<GameState> {
  const [player] = await db.select().from(playerProfile).where(eq(playerProfile.userId, userId)).limit(1);

  const skillRows = await db
    .select()
    .from(skills)
    .where(eq(skills.userId, userId))
    .orderBy(desc(skills.xp));

  const recentRows = await db
    .select({
      id: xpEvents.id,
      amount: xpEvents.amount,
      source: xpEvents.source,
      at: xpEvents.createdAt,
      skill: skills.name,
    })
    .from(xpEvents)
    .leftJoin(skills, eq(skills.id, xpEvents.skillId))
    .where(eq(xpEvents.userId, userId))
    .orderBy(desc(xpEvents.createdAt))
    .limit(15);

  const gameSkills: GameSkill[] = skillRows.map((s) => {
    const li = skillLevelFromXp(s.xp);
    const tier = tierForLevel(li.level);
    return {
      id: s.id, name: s.name, emoji: s.emoji, domain: s.domain, xp: s.xp,
      level: li.level, intoLevel: li.intoLevel, span: li.span,
      tier: tier.name, rarity: tier.rarity, color: tier.color,
    };
  });

  const pl = player ? playerLevelFromXp(player.totalXp) : playerLevelFromXp(0);
  const gamePlayer: GamePlayer = player
    ? {
        level: pl.level, totalXp: player.totalXp, intoLevel: pl.intoLevel, span: pl.span,
        rank: rankTitle(pl.level), streakDays: player.streakDays,
        dailyXp: player.dailyDateKey === todayKey() ? player.dailyXp : 0, dailyGoal: DAILY_GOAL,
      }
    : EMPTY_PLAYER;

  const unlockedMap = new Map((player?.unlocked ?? []).map((u) => [u.key, u.at]));
  const achievements: GameAchievement[] = ACHIEVEMENTS.map((a) => ({
    key: a.key, name: a.name, desc: a.desc, emoji: a.emoji,
    unlocked: unlockedMap.has(a.key), at: unlockedMap.get(a.key) ?? null,
  }));

  const recent: GameFeedEntry[] = recentRows.map((r) => ({
    id: r.id, amount: r.amount,
    label: SOURCE_LABEL[r.source as XpSource] ?? r.source,
    skill: r.skill, at: r.at.toISOString(),
  }));

  return { player: gamePlayer, skills: gameSkills, recent, achievements };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

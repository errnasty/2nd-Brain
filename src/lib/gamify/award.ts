// The single XP chokepoint. Every "earn XP" path calls awardXp(); it resolves
// the skill (explicit > cached-on-item > AI > folder > Reading > general),
// guards idempotency, applies XP to the skill + player, updates streak/daily/
// counters, evaluates achievements, and returns a rich result so the UI can
// celebrate. NEVER throws — XP is a side effect and must not break its host.

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  articles,
  directoryFolders,
  directoryItems,
  folders,
  playerProfile,
  skills,
  xpEvents,
} from "@/lib/db/schema";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { dayKey } from "@/lib/study/streak";
import {
  XP_RULES,
  SOURCE_COUNTER,
  DAILY_GOAL,
  DAILY_GOAL_BONUS,
  MOMENTUM_WINDOW_MINUTES,
  cardGradeXp,
  momentumMultiplier,
  momentumStep,
  withStreak,
  type XpSource,
} from "./rules";
import {
  skillLevelFromXp,
  playerLevelFromXp,
  tierForLevel,
  evolved,
  rankForLevel,
  promoted,
} from "./levels";
import { newlyUnlocked, achievementByKey, type AchievementSnapshot } from "./achievements";
import { classifyItemSkills } from "./skill-classifier";

export type AwardOptions = {
  source: XpSource;
  amount?: number;
  quality?: number; // card_graded scales with this
  itemId?: string | null; // resolve skill from this Directory item
  articleId?: string | null; // resolve skill from a feed article's folder
  skillName?: string | null; // explicit override (e.g. a task `(skill: X)`)
  refKind?: string; // idempotency key parts
  refId?: string;
  useAI?: boolean; // gate the AI classifier (item-level sources only)
};

export type AwardResult = {
  /** XP credited by this award, including any momentum/streak boost. */
  awarded: number;
  skipped?: boolean;
  skill?: { name: string; emoji: string | null; level: number; tier: string; color: string };
  skillLeveledUp?: boolean;
  evolvedTo?: string | null;
  /** Tier colors so the UI can theme the toast + confetti to the evolution. */
  evolvedColors?: { from: string; to: string } | null;
  playerLevel?: number;
  playerLeveledUp?: boolean;
  /** Set when the level-up also promoted the player into a new rank. */
  rankUpTo?: string | null;
  rankColors?: { from: string; to: string } | null;
  /** Consecutive-grade combo step this award rode (0 = none). */
  momentum?: number;
  /** Extra XP granted for crossing today's goal on this award (0 = none). */
  goalBonus?: number;
  newAchievements?: { key: string; name: string; emoji: string }[];
};

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
}

/**
 * Deterministic UUID from stable parts. player_profile (unique user_id) and
 * skills (unique user_id+domain+slug) must get the SAME id on every device, or
 * the desktop⇄cloud sync (which upserts on the primary key) hits the secondary
 * unique constraint and the row fails to merge / XP diverges. Hashing the
 * natural key makes both devices converge on one row.
 */
function stableUuid(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function yesterdayKey(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
}

async function findOrCreatePlayer(userId: string) {
  const [existing] = await db.select().from(playerProfile).where(eq(playerProfile.userId, userId)).limit(1);
  if (existing) return existing;
  // Deterministic id = userId so both devices converge on one row under sync.
  const [created] = await db
    .insert(playerProfile)
    .values({ id: userId, userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(playerProfile).where(eq(playerProfile.userId, userId)).limit(1);
  return row;
}

async function findOrCreateSkill(
  userId: string,
  name: string,
  emoji: string | null,
  domain = "knowledge",
) {
  const slug = slugify(name);
  const [existing] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), eq(skills.domain, domain), eq(skills.slug, slug)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(skills)
    // Deterministic id from the natural key so the same skill is one row across
    // devices (sync upserts on pk; random ids would collide on the unique key).
    .values({ id: stableUuid(userId, domain, slug), userId, name, slug, domain, emoji })
    .onConflictDoNothing({ target: [skills.userId, skills.domain, skills.slug] })
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), eq(skills.domain, domain), eq(skills.slug, slug)))
    .limit(1);
  return row;
}

const AI_SOURCES: Set<XpSource> = new Set([
  "note_created",
  "doc_uploaded",
  "article_saved",
  "distilled",
  "research",
  "curriculum",
]);

/** Resolve which skill this award belongs to (or null = general/player-only). */
async function resolveSkill(userId: string, opts: AwardOptions) {
  if (opts.skillName) return findOrCreateSkill(userId, opts.skillName, null);

  if (opts.itemId) {
    const [item] = await db
      .select({
        metadata: directoryItems.metadata,
        folderId: directoryItems.folderId,
        title: directoryItems.title,
      })
      .from(directoryItems)
      .where(and(eq(directoryItems.id, opts.itemId), eq(directoryItems.userId, userId)))
      .limit(1);
    if (!item) return null;

    // Cached skill on the item → reuse (no AI).
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const cachedId = typeof meta.skillId === "string" ? meta.skillId : null;
    if (cachedId) {
      const [s] = await db
        .select()
        .from(skills)
        .where(and(eq(skills.id, cachedId), eq(skills.userId, userId)))
        .limit(1);
      if (s) return s;
    }

    let skill: typeof skills.$inferSelect | undefined;

    // AI classify (item-level sources only), else folder name, else General.
    if (opts.useAI !== false && AI_SOURCES.has(opts.source)) {
      const resolved = await getDirectoryItemStudyText(userId, opts.itemId);
      const existing = (
        await db.select({ name: skills.name }).from(skills).where(eq(skills.userId, userId))
      ).map((r) => r.name);
      const ai = await classifyItemSkills(resolved?.title ?? item.title, resolved?.text ?? "", existing);
      if (ai) skill = await findOrCreateSkill(userId, ai.name, ai.emoji);
    }
    if (!skill) {
      let folderName = "General";
      if (item.folderId) {
        const [f] = await db
          .select({ name: directoryFolders.name })
          .from(directoryFolders)
          .where(eq(directoryFolders.id, item.folderId))
          .limit(1);
        if (f) folderName = f.name;
      }
      skill = await findOrCreateSkill(userId, folderName, null);
    }

    // Cache for next time (tasks/cards from this item skip AI + folder lookup).
    if (skill) {
      await db
        .update(directoryItems)
        .set({ metadata: { ...meta, skillId: skill.id } })
        .where(and(eq(directoryItems.id, opts.itemId), eq(directoryItems.userId, userId)));
    }
    return skill ?? null;
  }

  if (opts.articleId) {
    const [art] = await db
      .select({ folderId: articles.folderId })
      .from(articles)
      .where(and(eq(articles.id, opts.articleId), eq(articles.userId, userId)))
      .limit(1);
    let name = "Reading";
    if (art?.folderId) {
      const [f] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, art.folderId)).limit(1);
      if (f) name = f.name;
    }
    return findOrCreateSkill(userId, name, "📚");
  }

  return null;
}

export async function awardXp(userId: string, opts: AwardOptions): Promise<AwardResult> {
  try {
    const base = opts.source === "card_graded" ? cardGradeXp(opts.quality ?? 0) : opts.amount ?? XP_RULES[opts.source];
    if (!base || base <= 0) return { awarded: 0 };

    // Idempotency.
    if (opts.refKind && opts.refId) {
      const [dup] = await db
        .select({ id: xpEvents.id })
        .from(xpEvents)
        .where(
          and(
            eq(xpEvents.userId, userId),
            eq(xpEvents.source, opts.source),
            eq(xpEvents.refKind, opts.refKind),
            eq(xpEvents.refId, opts.refId),
          ),
        )
        .limit(1);
      if (dup) return { awarded: 0, skipped: true };
    }

    const player = await findOrCreatePlayer(userId);
    if (!player) return { awarded: 0 };

    // Streak + daily rollover.
    const today = dayKey(new Date());
    let streakDays = player.streakDays;
    if (player.lastActiveDateKey !== today) {
      streakDays = player.lastActiveDateKey === yesterdayKey(today) ? streakDays + 1 : 1;
    }

    // Session momentum: a review inside a run of recent reviews is worth more,
    // so working through a stack pays better than one card a day. Counted from
    // the ledger (server truth) — the client never gets to claim a combo.
    let momentum = 0;
    if (opts.source === "card_graded") {
      const since = new Date(Date.now() - MOMENTUM_WINDOW_MINUTES * 60_000);
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(xpEvents)
        .where(
          and(
            eq(xpEvents.userId, userId),
            eq(xpEvents.source, "card_graded"),
            gte(xpEvents.createdAt, since),
          ),
        );
      momentum = momentumStep(recent?.n ?? 0);
    }

    const amount = Math.round(withStreak(base, streakDays) * momentumMultiplier(momentum));

    // Daily goal: crossing it pays a one-off bonus that lands the same instant,
    // so the goal bar is a reward to chase rather than a progress indicator.
    const priorDaily = player.dailyDateKey === today ? player.dailyXp : 0;
    let goalBonus = 0;
    if (opts.source !== "daily_goal" && priorDaily < DAILY_GOAL && priorDaily + amount >= DAILY_GOAL) {
      // The daily snapshot above isn't transactional, so two awards landing at
      // once could both think they were the one to cross. The ledger row is the
      // tiebreaker: one bonus per day, whoever gets there first.
      const [already] = await db
        .select({ id: xpEvents.id })
        .from(xpEvents)
        .where(
          and(
            eq(xpEvents.userId, userId),
            eq(xpEvents.source, "daily_goal"),
            eq(xpEvents.refId, today),
          ),
        )
        .limit(1);
      if (!already) goalBonus = DAILY_GOAL_BONUS;
    }
    const credited = amount + goalBonus;

    // Resolve + apply skill.
    const skill = await resolveSkill(userId, opts);
    let skillResult: AwardResult["skill"];
    let skillLeveledUp = false;
    let evolvedTo: string | null = null;
    let evolvedColors: { from: string; to: string } | null = null;
    if (skill) {
      // Atomic increment (returning the new total) so rapid concurrent grades of
      // the same skill can't lose XP via read-modify-write.
      const [srow] = await db
        .update(skills)
        .set({ xp: sql`${skills.xp} + ${amount}`, updatedAt: new Date() })
        .where(eq(skills.id, skill.id))
        .returning({ xp: skills.xp });
      const newXp = srow?.xp ?? skill.xp + amount;
      const oldLevel = skillLevelFromXp(Math.max(0, newXp - amount)).level;
      const newLevel = skillLevelFromXp(newXp).level;
      // level is a cache (state.ts recomputes from xp) — only write when it moves.
      if (newLevel !== oldLevel) {
        await db.update(skills).set({ level: newLevel }).where(eq(skills.id, skill.id));
      }
      skillLeveledUp = newLevel > oldLevel;
      const newTier = tierForLevel(newLevel);
      const crossed = evolved(oldLevel, newLevel);
      evolvedTo = crossed?.name ?? null;
      evolvedColors = crossed ? { from: crossed.from, to: crossed.to } : null;
      skillResult = {
        name: skill.name,
        emoji: skill.emoji,
        level: newLevel,
        tier: newTier.name,
        color: newTier.color,
      };
    }

    // Ledger. The goal bonus is a separate, player-only row so the XP feed
    // reads honestly ("+50 hit the daily goal") instead of silently fattening
    // whatever award happened to tip it over.
    await db.insert(xpEvents).values({
      userId,
      skillId: skill?.id ?? null,
      source: opts.source,
      amount,
      refKind: opts.refKind ?? null,
      refId: opts.refId ?? null,
    });
    if (goalBonus > 0) {
      await db.insert(xpEvents).values({
        userId,
        skillId: null,
        source: "daily_goal",
        amount: goalBonus,
        refKind: "daily_goal",
        refId: today,
      });
    }

    // Player aggregates + counters + achievements.
    const counters = { ...(player.counters ?? {}) };
    const counterKey = SOURCE_COUNTER[opts.source];
    if (counterKey) counters[counterKey] = (counters[counterKey] ?? 0) + 1;

    if (goalBonus > 0) counters.goalsHit = (counters.goalsHit ?? 0) + 1;

    // Estimated values for the achievement snapshot (authoritative total is
    // read back from the atomic update below).
    const newTotal = player.totalXp + credited;
    const newPlayerLevel = playerLevelFromXp(newTotal).level;

    // Skill aggregates for achievement predicates.
    const [agg] = await db
      .select({ maxLevel: sql<number>`coalesce(max(${skills.level}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(skills)
      .where(eq(skills.userId, userId));

    const snapshot: AchievementSnapshot = {
      totalXp: newTotal,
      playerLevel: newPlayerLevel,
      streakDays,
      maxSkillLevel: agg?.maxLevel ?? 0,
      skillCount: agg?.count ?? 0,
      counters,
    };
    const have = (player.unlocked ?? []).map((u) => u.key);
    const fresh = newlyUnlocked(snapshot, have);
    const unlocked = fresh.length
      ? [...(player.unlocked ?? []), ...fresh.map((key) => ({ key, at: new Date().toISOString() }))]
      : player.unlocked ?? [];

    // Atomic total/daily increments (returning the new total) so overlapping
    // awards can't lose XP. daily resets in-statement when the day rolls over.
    const [prow] = await db
      .update(playerProfile)
      .set({
        totalXp: sql`${playerProfile.totalXp} + ${credited}`,
        streakDays,
        lastActiveDateKey: today,
        dailyXp: sql`case when ${playerProfile.dailyDateKey} = ${today} then ${playerProfile.dailyXp} + ${credited} else ${credited} end`,
        dailyDateKey: today,
        counters,
        unlocked,
        updatedAt: new Date(),
      })
      .where(eq(playerProfile.userId, userId))
      .returning({ totalXp: playerProfile.totalXp });

    // Authoritative level from the DB-truth total; level column is a cache.
    const authTotal = prow?.totalXp ?? newTotal;
    const authNewLevel = playerLevelFromXp(authTotal).level;
    const authOldLevel = playerLevelFromXp(Math.max(0, authTotal - credited)).level;
    if (authNewLevel !== authOldLevel) {
      await db.update(playerProfile).set({ level: authNewLevel }).where(eq(playerProfile.userId, userId));
    }
    const rankUp = promoted(authOldLevel, authNewLevel);

    return {
      awarded: credited,
      skill: skillResult,
      skillLeveledUp,
      evolvedTo,
      evolvedColors,
      playerLevel: authNewLevel,
      playerLeveledUp: authNewLevel > authOldLevel,
      rankUpTo: rankUp?.title ?? null,
      rankColors: rankUp
        ? { from: rankUp.from, to: rankUp.to }
        : { from: rankForLevel(authNewLevel).from, to: rankForLevel(authNewLevel).to },
      momentum,
      goalBonus,
      newAchievements: fresh
        .map((key) => achievementByKey(key))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({ key: a.key, name: a.name, emoji: a.emoji })),
    };
  } catch (err) {
    console.warn("awardXp failed:", err instanceof Error ? err.message : err);
    return { awarded: 0 };
  }
}

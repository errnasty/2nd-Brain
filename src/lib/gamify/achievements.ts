// Achievement definitions + a pure evaluator. Add an entry to ACHIEVEMENTS to
// ship a new badge — no other code changes. Unlocked state lives in
// player_profile.unlocked; definitions (name/emoji/test) live here.

export type AchievementSnapshot = {
  totalXp: number;
  playerLevel: number;
  streakDays: number;
  maxSkillLevel: number;
  skillCount: number;
  counters: Record<string, number>;
};

export type Achievement = {
  key: string;
  name: string;
  desc: string;
  emoji: string;
  test: (s: AchievementSnapshot) => boolean;
};

const c = (s: AchievementSnapshot, k: string) => s.counters[k] ?? 0;

export const ACHIEVEMENTS: Achievement[] = [
  { key: "first_xp", name: "First steps", desc: "Earn your first XP", emoji: "✨", test: (s) => s.totalXp > 0 },
  { key: "level_5", name: "Getting serious", desc: "Reach player level 5", emoji: "🚀", test: (s) => s.playerLevel >= 5 },
  { key: "level_10", name: "Dedicated", desc: "Reach player level 10", emoji: "🏆", test: (s) => s.playerLevel >= 10 },
  { key: "streak_7", name: "Streak keeper", desc: "A 7-day streak", emoji: "🔥", test: (s) => s.streakDays >= 7 },
  { key: "streak_30", name: "Unstoppable", desc: "A 30-day streak", emoji: "⚡", test: (s) => s.streakDays >= 30 },
  { key: "cards_50", name: "Card sharp", desc: "Grade 50 flashcards", emoji: "🃏", test: (s) => c(s, "cardsGraded") >= 50 },
  { key: "tasks_25", name: "Taskmaster", desc: "Complete 25 tasks", emoji: "✅", test: (s) => c(s, "tasksDone") >= 25 },
  { key: "reader_50", name: "Bookworm", desc: "Read 50 articles", emoji: "📚", test: (s) => c(s, "articlesRead") >= 50 },
  { key: "notes_25", name: "Scribe", desc: "Write 25 notes", emoji: "✍️", test: (s) => c(s, "notesCreated") >= 25 },
  { key: "skill_adept", name: "Specializing", desc: "Take a skill to Adept (Lv10)", emoji: "🎯", test: (s) => s.maxSkillLevel >= 10 },
  { key: "skill_master", name: "Ascended", desc: "Take a skill to Master (Lv35)", emoji: "👑", test: (s) => s.maxSkillLevel >= 35 },
  { key: "polymath", name: "Polymath", desc: "Grow 5 different skills", emoji: "🧠", test: (s) => s.skillCount >= 5 },
];

/** Returns the keys newly unlocked by this snapshot (not already in `have`). */
export function newlyUnlocked(snapshot: AchievementSnapshot, have: Iterable<string>): string[] {
  const had = have instanceof Set ? have : new Set(have);
  return ACHIEVEMENTS.filter((a) => !had.has(a.key) && a.test(snapshot)).map((a) => a.key);
}

export function achievementByKey(key: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}

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

// Thresholds track the tier/rank boundaries in levels.ts — keep them in sync
// when a curve moves, or a badge either becomes free or becomes unreachable.
export const ACHIEVEMENTS: Achievement[] = [
  { key: "first_xp", name: "First steps", desc: "Earn your first XP", emoji: "✨", test: (s) => s.totalXp > 0 },
  { key: "level_5", name: "Getting serious", desc: "Reach player level 5", emoji: "🚀", test: (s) => s.playerLevel >= 5 },
  { key: "level_10", name: "Dedicated", desc: "Reach player level 10", emoji: "🏆", test: (s) => s.playerLevel >= 10 },
  { key: "level_25", name: "Seasoned", desc: "Reach player level 25", emoji: "🌟", test: (s) => s.playerLevel >= 25 },
  { key: "level_50", name: "Ascended", desc: "Reach player level 50", emoji: "🔱", test: (s) => s.playerLevel >= 50 },
  { key: "streak_7", name: "Streak keeper", desc: "A 7-day streak", emoji: "🔥", test: (s) => s.streakDays >= 7 },
  { key: "streak_30", name: "Unstoppable", desc: "A 30-day streak", emoji: "⚡", test: (s) => s.streakDays >= 30 },
  { key: "streak_100", name: "Centurion", desc: "A 100-day streak", emoji: "💯", test: (s) => s.streakDays >= 100 },
  { key: "cards_50", name: "Card sharp", desc: "Grade 50 flashcards", emoji: "🃏", test: (s) => c(s, "cardsGraded") >= 50 },
  { key: "cards_500", name: "Deck runner", desc: "Grade 500 flashcards", emoji: "🎴", test: (s) => c(s, "cardsGraded") >= 500 },
  { key: "tasks_25", name: "Taskmaster", desc: "Complete 25 tasks", emoji: "✅", test: (s) => c(s, "tasksDone") >= 25 },
  { key: "reader_50", name: "Bookworm", desc: "Read 50 articles", emoji: "📚", test: (s) => c(s, "articlesRead") >= 50 },
  { key: "chapters_100", name: "Page turner", desc: "Read 100 chapters", emoji: "🔖", test: (s) => c(s, "chaptersRead") >= 100 },
  { key: "book_1", name: "Cover to cover", desc: "Finish your first book", emoji: "📖", test: (s) => c(s, "booksFinished") >= 1 },
  { key: "book_5", name: "Shelf builder", desc: "Finish 5 books", emoji: "📚", test: (s) => c(s, "booksFinished") >= 5 },
  { key: "book_25", name: "Well read", desc: "Finish 25 books", emoji: "🏛️", test: (s) => c(s, "booksFinished") >= 25 },
  { key: "notes_25", name: "Scribe", desc: "Write 25 notes", emoji: "✍️", test: (s) => c(s, "notesCreated") >= 25 },
  { key: "goal_10", name: "Goal getter", desc: "Hit the daily goal 10 times", emoji: "🎯", test: (s) => c(s, "goalsHit") >= 10 },
  { key: "goal_50", name: "Metronome", desc: "Hit the daily goal 50 times", emoji: "⏱️", test: (s) => c(s, "goalsHit") >= 50 },
  { key: "sessions_10", name: "Regular", desc: "Finish 10 daily sessions", emoji: "🗓️", test: (s) => c(s, "sessionsDone") >= 10 },
  { key: "concepts_25", name: "Curious", desc: "Read 25 concept cards", emoji: "🌱", test: (s) => c(s, "conceptsLearned") >= 25 },
  { key: "concepts_100", name: "Wide reader", desc: "Read 100 concept cards", emoji: "🗺️", test: (s) => c(s, "conceptsLearned") >= 100 },
  { key: "briefs_10", name: "Well briefed", desc: "Read 10 daily briefs end to end", emoji: "📰", test: (s) => c(s, "briefsRead") >= 10 },
  { key: "briefs_50", name: "Desk editor", desc: "Read 50 daily briefs end to end", emoji: "🗞️", test: (s) => c(s, "briefsRead") >= 50 },
  { key: "skill_adept", name: "Specializing", desc: "Take a skill to Adept (Lv7)", emoji: "🔷", test: (s) => s.maxSkillLevel >= 7 },
  { key: "skill_expert", name: "Expertise", desc: "Take a skill to Expert (Lv12)", emoji: "🔮", test: (s) => s.maxSkillLevel >= 12 },
  { key: "skill_virtuoso", name: "Virtuoso", desc: "Take a skill to Legendary (Lv20)", emoji: "🌠", test: (s) => s.maxSkillLevel >= 20 },
  { key: "skill_master", name: "Mythic", desc: "Take a skill to Master (Lv30)", emoji: "👑", test: (s) => s.maxSkillLevel >= 30 },
  { key: "skill_grandmaster", name: "Radiant", desc: "Take a skill to Grandmaster (Lv42)", emoji: "💎", test: (s) => s.maxSkillLevel >= 42 },
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

// XP economy — all tunable in one place. Pure (no deps) so it's unit-tested.

/** Every way to earn XP. Add a source here + call awardXp to extend (e.g. a
 *  future 'workout_logged' for the fitness domain). */
export type XpSource =
  | "task_done"
  | "card_graded"
  | "cards_made"
  | "article_read"
  | "article_saved"
  | "note_created"
  | "doc_uploaded"
  | "distilled"
  | "research"
  | "curriculum"
  | "quiz_made"
  | "quiz_completed";

/** Base XP per source. card_graded is computed separately (scales with grade);
 *  quiz_completed's caller passes an explicit `amount` scaled by score. */
export const XP_RULES: Record<XpSource, number> = {
  task_done: 15,
  card_graded: 6, // base; see cardGradeXp
  cards_made: 10,
  article_read: 5,
  article_saved: 10,
  note_created: 10,
  doc_uploaded: 20,
  distilled: 15,
  research: 25,
  curriculum: 25,
  quiz_made: 15,
  quiz_completed: 10, // fallback only — callers pass a score-scaled `amount`
};

/** Human label for the activity feed. */
export const SOURCE_LABEL: Record<XpSource, string> = {
  task_done: "completed a task",
  card_graded: "reviewed a card",
  cards_made: "made flashcards",
  article_read: "read an article",
  article_saved: "saved an article",
  note_created: "wrote a note",
  doc_uploaded: "uploaded a document",
  distilled: "distilled an item",
  research: "researched a gap",
  curriculum: "built a curriculum",
  quiz_made: "made a quiz",
  quiz_completed: "completed a quiz",
};

/** A flashcard review scales with recall quality (0–5): 4–16 XP. */
export function cardGradeXp(quality: number): number {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  return 4 + q * 2;
}

/** Which `counters` key a source bumps (for achievements). null = no counter. */
export const SOURCE_COUNTER: Record<XpSource, string | null> = {
  task_done: "tasksDone",
  card_graded: "cardsGraded",
  cards_made: null,
  article_read: "articlesRead",
  article_saved: null,
  note_created: "notesCreated",
  doc_uploaded: "docsUploaded",
  distilled: "distills",
  research: null,
  curriculum: null,
  quiz_made: null,
  quiz_completed: "quizzesCompleted",
};

export const DAILY_GOAL = 100;

/** Streak multiplier: +5% per consecutive day, capped at +35% (7 days). */
export function streakMultiplier(streakDays: number): number {
  return 1 + Math.min(Math.max(0, streakDays), 7) * 0.05;
}

/** Apply the streak multiplier to a base amount (rounded). */
export function withStreak(amount: number, streakDays: number): number {
  return Math.round(amount * streakMultiplier(streakDays));
}

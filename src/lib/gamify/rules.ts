// XP economy — all tunable in one place. Pure (no deps) so it's unit-tested.

/** Every way to earn XP. Add a source here + call awardXp to extend (e.g. a
 *  future 'workout_logged' for the fitness domain). */
export type XpSource =
  | "task_done"
  | "card_graded"
  | "cards_made"
  | "article_read"
  | "article_saved"
  | "article_starred"
  | "article_read_later"
  | "note_created"
  | "doc_uploaded"
  | "distilled"
  | "research"
  | "curriculum"
  | "quiz_made"
  | "quiz_completed"
  | "deck_finished"
  | "session_complete"
  | "daily_goal";

/** Base XP per source. card_graded is computed separately (scales with grade);
 *  quiz_completed's caller passes an explicit `amount` from quizXp().
 *
 *  Weighted towards recall, not consumption. Reading is the input; remembering
 *  is the outcome. Paying well for article_read rewards volume, which rewards
 *  skimming — you can farm it without learning anything. So reading earns a
 *  modest amount and the sources that require actually retrieving something
 *  (grading, making cards, quizzes, finishing a deck) carry the weight.
 *
 *  Engaging with an article — starring it, sending it to read-later — pays a
 *  little on top, because those are deliberate acts on one specific piece
 *  rather than scrolling. Each is awarded once per article ever (refKind +
 *  refId), so toggling a star on and off cannot farm it. */
export const XP_RULES: Record<XpSource, number> = {
  task_done: 15,
  card_graded: 8, // base; see cardGradeXp
  cards_made: 18,
  article_read: 4,
  article_saved: 10,
  article_starred: 5,
  article_read_later: 3,
  note_created: 10,
  doc_uploaded: 20,
  distilled: 18,
  research: 25,
  curriculum: 25,
  quiz_made: 15,
  quiz_completed: 20, // fallback only — callers pass quizXp(score, total)
  deck_finished: 30,
  session_complete: 40, // finishing a composed "Today's session" end to end
  daily_goal: 50, // auto-granted the moment the daily goal is crossed
};

/** Human label for the activity feed. */
export const SOURCE_LABEL: Record<XpSource, string> = {
  task_done: "completed a task",
  card_graded: "reviewed a card",
  cards_made: "made flashcards",
  article_read: "read an article",
  article_saved: "saved an article",
  article_starred: "starred an article",
  article_read_later: "saved an article for later",
  note_created: "wrote a note",
  doc_uploaded: "uploaded a document",
  distilled: "distilled an item",
  research: "researched a gap",
  curriculum: "built a curriculum",
  quiz_made: "made a quiz",
  quiz_completed: "completed a quiz",
  deck_finished: "finished a ThinkTank deck",
  session_complete: "finished today's session",
  daily_goal: "hit the daily goal",
};

/**
 * A flashcard review scales with recall quality (0–5): 5–15 XP.
 *
 * Deliberately below a quiz: one card is one retrieval, and a review session is
 * dozens of them (with the momentum multiplier on top). A quiz is a single
 * graded run across a whole topic, so it should be worth several cards.
 */
export function cardGradeXp(quality: number): number {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  return 5 + q * 2;
}

/**
 * A quiz attempt: 12 XP for turning up, up to 50 for a perfect run.
 *
 * Much more score-sensitive than a card grade, because a card's grade is
 * self-reported ("that felt easy") while a quiz score is checked against the
 * right answer. Getting it wrong should be worth noticeably less than getting
 * it right, which is only fair when something is actually marking you.
 */
export const QUIZ_XP_BASE = 12;
export const QUIZ_XP_MAX = 50;

export function quizXp(score: number, total: number): number {
  if (total <= 0) return QUIZ_XP_BASE;
  const pct = Math.max(0, Math.min(1, score / total));
  return QUIZ_XP_BASE + Math.round(pct * (QUIZ_XP_MAX - QUIZ_XP_BASE));
}

/** Which `counters` key a source bumps (for achievements). null = no counter. */
export const SOURCE_COUNTER: Record<XpSource, string | null> = {
  task_done: "tasksDone",
  card_graded: "cardsGraded",
  cards_made: null,
  article_read: "articlesRead",
  article_saved: null,
  article_starred: null,
  article_read_later: null,
  note_created: "notesCreated",
  doc_uploaded: "docsUploaded",
  distilled: "distills",
  research: null,
  curriculum: null,
  quiz_made: null,
  quiz_completed: "quizzesCompleted",
  deck_finished: null,
  session_complete: "sessionsDone",
  daily_goal: "goalsHit",
};

export const DAILY_GOAL = 100;

/** Bonus XP granted once per day, the moment `dailyXp` crosses DAILY_GOAL. */
export const DAILY_GOAL_BONUS = XP_RULES.daily_goal;

/** Streak multiplier: +6% per consecutive day, capped at +60% (10 days). */
export function streakMultiplier(streakDays: number): number {
  return 1 + Math.min(Math.max(0, streakDays), 10) * 0.06;
}

/** Apply the streak multiplier to a base amount (rounded). */
export function withStreak(amount: number, streakDays: number): number {
  return Math.round(amount * streakMultiplier(streakDays));
}

// ── Session momentum ────────────────────────────────────────────────────

/** Cards graded inside this window still count towards the momentum combo. */
export const MOMENTUM_WINDOW_MINUTES = 15;
/** Recent-grade count at which the momentum bonus tops out. */
export const MOMENTUM_CAP = 10;

/**
 * Momentum ("combo") multiplier for a review session: +5% for every card
 * already graded in the last MOMENTUM_WINDOW_MINUTES, capped at +50%.
 *
 * Derived server-side from the XP ledger rather than passed in by the client,
 * so it can't be inflated — and it rewards the behaviour that actually matters,
 * sitting down and working through a stack instead of grading one card a day.
 */
export function momentumMultiplier(recentGrades: number): number {
  return 1 + Math.min(Math.max(0, recentGrades), MOMENTUM_CAP) * 0.05;
}

/** The combo step shown in the HUD (0 = no combo, 1.. = "x2 combo" and up). */
export function momentumStep(recentGrades: number): number {
  return Math.min(Math.max(0, recentGrades), MOMENTUM_CAP);
}

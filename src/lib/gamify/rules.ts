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
  | "daily_goal"
  | "brief_article"
  | "brief_complete"
  | "brief_source_opened";

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
  // Daily Brief. Paid PER CITED ARTICLE, into the skill of the folder that
  // article lives in — so reading a section that covers three Data Science
  // pieces and one Geopolitics piece pays 12 into Data Science and 4 into
  // Geopolitics. Matching article_read (4) is deliberate: being briefed on a
  // piece is worth what skimming it is worth.
  //
  // Granted once per article per DAY (not per section), so an article that
  // appears in both the lead and its desk pays once.
  brief_article: 4,
  brief_complete: 15,
  brief_source_opened: 2,
};

/**
 * Ceiling on brief XP in a day, excluding the completion bonus.
 *
 * Per-article pricing is the right shape — it tracks how much you actually
 * read — but it multiplies: a Standard brief cites roughly 45 distinct
 * articles, which at 4 each would be ~180 XP from one screen, against a daily
 * goal of 100. That would make the brief the only thing worth doing.
 *
 * The cap keeps a full brief at 50 + 15 = 65: comfortably above finishing a
 * study session (40), comfortably below the day's goal. Raise or remove it
 * here — nothing else needs to change.
 */
export const BRIEF_DAILY_XP_CAP = 50;

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
  brief_article: "read about an article in the brief",
  brief_complete: "read the whole daily brief",
  brief_source_opened: "opened a source from the brief",
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
  // Only completion bumps a counter. Counting sections read would inflate the
  // achievement roughly fivefold per brief and make "briefs read" meaningless.
  brief_article: null,
  brief_complete: "briefsRead",
  brief_source_opened: null,
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

// ── Daily Brief: splitting one section's XP across folders ──────────────

/**
 * Divide a section's XP budget among the folders its articles came from,
 * proportionally to how much of the section each folder accounted for.
 *
 * The point is that reading a brief feeds the SKILLS the reading was actually
 * about. A section covering three Data Science articles and one Geopolitics
 * article should move the Data Science skill about three times as far — which
 * it can only do if the budget is divided rather than granted per folder.
 *
 * Two properties this has to hold, and neither is automatic:
 *
 *   - The parts must sum to exactly `total`. Rounding each share independently
 *     overshoots (4.5 + 1.5 → 5 + 2 = 7 from a budget of 6), which quietly
 *     inflates the whole economy in proportion to how many folders a reader
 *     spreads across. Largest-remainder apportionment fixes the sum.
 *   - Every contributing folder should get at least 1, or a folder with one
 *     article in a busy section silently earns nothing and the feature looks
 *     broken to the person who noticed their article was in there.
 *
 * When there are more folders than XP to go round, the minimum wins over
 * proportionality: the largest contributors get 1 each until the budget is
 * spent. Handing out zeros to satisfy exact shares would be the worse failure.
 */
export function splitXpByWeight(weights: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0 || total <= 0) return new Array<number>(n).fill(0);

  const safe = weights.map((w) => Math.max(0, w));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (sum <= 0) return new Array<number>(n).fill(0);

  // More folders than there is XP: pay the biggest contributors 1 each.
  if (n > total) {
    const order = safe
      .map((w, i) => ({ i, w }))
      .sort((a, b) => (b.w !== a.w ? b.w - a.w : a.i - b.i))
      .slice(0, total);
    const out = new Array<number>(n).fill(0);
    for (const { i } of order) out[i] = 1;
    return out;
  }

  const exact = safe.map((w) => (w / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let left = total - out.reduce((a, b) => a + b, 0);

  // Largest remainder first, so the sum lands exactly on `total`.
  const byRemainder = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : a.i - b.i));
  for (let k = 0; k < byRemainder.length && left > 0; k += 1) {
    out[byRemainder[k].i] += 1;
    left -= 1;
  }

  // Lift any zeroed folder to 1, taking from whoever can most afford it. The
  // n <= total check above guarantees this terminates with everyone on 1+.
  for (let i = 0; i < n; i += 1) {
    if (out[i] > 0) continue;
    let donor = -1;
    for (let j = 0; j < n; j += 1) {
      if (out[j] >= 2 && (donor === -1 || out[j] > out[donor])) donor = j;
    }
    if (donor === -1) break;
    out[donor] -= 1;
    out[i] += 1;
  }

  return out;
}

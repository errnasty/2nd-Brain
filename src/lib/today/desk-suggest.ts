/**
 * Desks the reader has not thought to create.
 *
 * ## Two signals, one answer
 *
 * Custom desks solve a real problem and have one weakness: you have to know
 * what you are missing. A reader whose Singapore stories are scattered across
 * three built-in desks experiences that as "the brief is a bit unfocused", not
 * as "I should create a Singapore desk" — the shape of the gap is invisible
 * from inside it.
 *
 * Two pieces of evidence already exist that name the gap exactly:
 *
 *   1. **What you save and open.** The articles a reader stars, saves for later
 *      or actually reads are a statement of interest they have already made,
 *      article by article, without being asked.
 *   2. **What you said was misfiled.** Marking a bullet "wrong desk" is a
 *      correction, and a run of corrections that all mention the same thing is
 *      not really a complaint about the desk — it is the missing desk, being
 *      described one story at a time.
 *
 * The second is the sharper signal by a distance, which is why a misfile counts
 * for several saves here. It is also why the two live in one module: "you have
 * told me four times that Singapore stories don't belong on World Affairs"
 * *is* the suggestion, and splitting the correction from the offer would have
 * thrown away the best evidence in the app.
 *
 * ## Nothing to remember
 *
 * A suggestion appears inside the Desks menu — the place a reader already goes
 * to think about desks — pre-filled and dismissable, never as a notification or
 * a new surface. If it is wrong it costs a glance.
 *
 * Pure: the queries live in `reading-signals.ts`.
 */

import { titleWords } from "@/lib/trending/cluster";
import { BRIEF_TOPICS, customDeskId, type BriefTopic } from "./topics";

/** A story the reader said was on the wrong desk. */
export type MisfiledStory = {
  /** The headline as it was cited. Matched by term, not by identity. */
  title: string;
  /** The desk it was wrongly filed under. */
  deskId: string;
  at: string;
};

/** How long a correction keeps counting. */
export const MISFILE_WINDOW_DAYS = 90;
/** Ceiling on stored corrections — they ride in the settings blob. */
export const MAX_MISFILES = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Validate whatever is in the settings blob, dropping anything stale. */
export function normalizeMisfiles(v: unknown, now: Date = new Date()): MisfiledStory[] {
  if (!Array.isArray(v)) return [];
  const out: MisfiledStory[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Partial<MisfiledStory>;
    const title = typeof m.title === "string" ? m.title.trim().slice(0, 300) : "";
    const deskId = typeof m.deskId === "string" ? m.deskId.slice(0, 64) : "";
    if (!title || !deskId) continue;
    const at = typeof m.at === "string" && Number.isFinite(Date.parse(m.at)) ? m.at : now.toISOString();
    if (now.getTime() - Date.parse(at) > MISFILE_WINDOW_DAYS * DAY_MS) continue;
    out.push({ title, deskId, at });
  }
  // Newest first, then capped, so the cap drops the oldest corrections.
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_MISFILES);
}

/**
 * Whether this desk has been ruled out for this story.
 *
 * A correction is honoured immediately and directly: the desk the reader
 * rejected is simply not available to that story next time. Waiting for a
 * suggestion to be accepted before anything changes would make the first four
 * corrections do nothing at all, which reads as the button being broken.
 *
 * Matched on shared distinctive terms rather than exact title, so tomorrow's
 * telling of the same story is corrected too.
 */
export function isRuledOut(title: string, deskId: string, misfiles: MisfiledStory[]): boolean {
  if (misfiles.length === 0) return false;
  const words = new Set(distinctiveWords(title));
  if (words.size === 0) return false;
  for (const m of misfiles) {
    if (m.deskId !== deskId) continue;
    const theirs = distinctiveWords(m.title);
    if (theirs.length === 0) continue;
    let shared = 0;
    for (const w of theirs) if (words.has(w)) shared += 1;
    // Two distinctive words in common is a low bar for "same subject" and a
    // high one for coincidence, given how few distinctive words a headline has.
    if (shared >= 2) return true;
  }
  return false;
}

/** A desk the reader might want, and the evidence for it. */
export type DeskSuggestion = {
  /** Proposed desk id, so accepting it twice cannot create two desks. */
  id: string;
  /** Proposed name — the term, title-cased. */
  label: string;
  /** Proposed match terms, best first. */
  keywords: string[];
  /** Plain-language evidence, shown to the reader verbatim. */
  reason: string;
  /** Ranking weight. Not shown. */
  weight: number;
};

/** Shortest term worth proposing a desk around. */
const MIN_TERM_LENGTH = 4;

/**
 * Words that can never name a desk.
 *
 * The clustering stop-list this builds on is tuned for headline OVERLAP, where
 * "report" and "update" carry real signal about two articles being the same
 * story. For naming a desk they carry none, and they are frequent enough to
 * win on count every time — the first version of this cheerfully proposed a
 * desk called "Number".
 *
 * A list, rather than something cleverer, on purpose. Distinguishing "a proper
 * noun or a field of interest" from "generic news vocabulary" properly means
 * part-of-speech tagging or an embedding, which is a large amount of machinery
 * for deciding whether to offer a chip inside a menu. A term that slips through
 * costs one glance and a dismissal; the list can grow when one does.
 */
const GENERIC_WORDS = new Set([
  "number", "story", "stories", "update", "updates", "report", "reports", "news",
  "latest", "today", "week", "weeks", "month", "months", "year", "years", "day",
  "days", "plan", "plans", "deal", "deals", "move", "moves", "call", "calls",
  "make", "makes", "take", "takes", "back", "more", "most", "best", "worst",
  "here", "what", "when", "where", "which", "will", "would", "could", "should",
  "about", "after", "before", "against", "between", "during", "just", "like",
  "than", "them", "they", "this", "that", "with", "your", "you", "our", "their",
  "first", "second", "third", "next", "last", "still", "even", "much", "many",
  "some", "such", "into", "over", "under", "from", "have", "been", "being",
  "were", "was", "are", "big", "top", "set", "sets", "way", "ways", "thing",
  "things", "people", "world", "part", "case", "cases", "issue", "issues",
  "problem", "problems", "question", "questions", "look", "looks", "know",
  "think", "want", "need", "says", "said", "told", "adds", "gets", "goes",
  "does", "doing", "done", "made", "makes", "making", "coming", "comes",
  "going", "gone", "keep", "keeps", "left", "seen", "show", "shows", "found",
  "given", "gives", "helps", "seems", "turns", "puts", "sees", "faces",
]);
/** Saved/read articles a term must appear in before it is a pattern. */
const MIN_ENGAGED_HITS = 5;
/** …or corrections, which are worth far more each. */
const MIN_MISFILE_HITS = 3;
/** How many saves one correction is worth. */
const MISFILE_WEIGHT = 4;

/**
 * Words from a headline that could name a desk: long enough to be specific,
 * with the clustering stop-list already applied.
 */
function distinctiveWords(title: string): string[] {
  return [...new Set(titleWords(title))].filter(
    (w) => w.length >= MIN_TERM_LENGTH && !GENERIC_WORDS.has(w),
  );
}

/** Every term the reader's current desks already claim. */
function claimedTerms(desks: BriefTopic[]): Set<string> {
  const out = new Set<string>();
  for (const d of desks) {
    for (const list of [d.strong, d.weak]) {
      for (const k of list) for (const w of k.split(" ")) out.add(w);
    }
    for (const w of titleWords(d.label)) out.add(w);
  }
  return out;
}

/**
 * Desks worth offering, strongest first.
 *
 * A term is only a candidate if no existing desk already claims it — the point
 * is the gap, and "add an AI desk" to somebody who has one is noise that
 * teaches the reader to ignore the whole feature.
 */
export function suggestDesks(opts: {
  /** Titles of articles the reader saved, starred or read. */
  engagedTitles?: string[];
  misfiles?: MisfiledStory[];
  /** The reader's current desks, built-in and custom. */
  desks?: BriefTopic[];
  limit?: number;
}): DeskSuggestion[] {
  const engaged = opts.engagedTitles ?? [];
  const misfiles = opts.misfiles ?? [];
  const desks = opts.desks ?? BRIEF_TOPICS;
  const claimed = claimedTerms(desks);

  const engagedHits = new Map<string, number>();
  for (const t of engaged) {
    for (const w of distinctiveWords(t)) engagedHits.set(w, (engagedHits.get(w) ?? 0) + 1);
  }
  const misfileHits = new Map<string, number>();
  for (const m of misfiles) {
    for (const w of distinctiveWords(m.title)) misfileHits.set(w, (misfileHits.get(w) ?? 0) + 1);
  }

  const out: DeskSuggestion[] = [];
  for (const term of new Set([...engagedHits.keys(), ...misfileHits.keys()])) {
    if (claimed.has(term)) continue;
    const saves = engagedHits.get(term) ?? 0;
    const corrections = misfileHits.get(term) ?? 0;
    if (saves < MIN_ENGAGED_HITS && corrections < MIN_MISFILE_HITS) continue;

    // The correction is the better story to tell, so it wins the sentence when
    // there is one — it names what the reader actually objected to.
    const reason =
      corrections >= MIN_MISFILE_HITS
        ? `You've marked ${corrections} ${corrections === 1 ? "story" : "stories"} mentioning “${term}” as wrongly filed`
        : `${saves} articles you saved or read mention “${term}”`;

    out.push({
      id: customDeskId(term),
      label: term.charAt(0).toUpperCase() + term.slice(1),
      keywords: [term],
      reason,
      weight: saves + corrections * MISFILE_WEIGHT,
    });
  }

  return out
    .sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.label.localeCompare(b.label)))
    .slice(0, Math.max(0, opts.limit ?? 2));
}

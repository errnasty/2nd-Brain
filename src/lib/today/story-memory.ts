/**
 * What the brief has already told you.
 *
 * ## The problem
 *
 * Every brief was generated from scratch against the current unread queue, so
 * a story running for three days was introduced from zero three mornings in a
 * row. That is the difference between a summary and a briefing: a summary
 * describes a pile of articles, a briefing tells you what has changed since
 * the last one. Without a record of what was said yesterday, the second thing
 * is impossible however good the prompt is.
 *
 * ## Why titles rather than cluster ids
 *
 * `story_clusters` rows are deleted and rebuilt on every trending pass, so a
 * cluster id is stable for an hour, not a day — remembering one would be
 * remembering a row number. What is stable is roughly what the story is
 * called, so matching runs on normalized title shingles with the same measure
 * and the same threshold the clustering itself uses (`cluster.ts`). That
 * tolerates the drift a story's framing genuinely has overnight ("X resigns" →
 * "X resigns: what happens now") without matching two unrelated headlines that
 * share a couple of common words.
 *
 * A story whose framing changes beyond recognition is simply treated as new.
 * That is the right failure: re-introducing something the reader half
 * remembers costs a sentence, while telling them "as you saw yesterday" about
 * a story they were never told about is a straight falsehood.
 *
 * Pure and storage-agnostic: the memory is a plain JSON array carried on the
 * user's stored brief.
 */

import { TITLE_SHINGLE_THRESHOLD, jaccard, titleShingles } from "@/lib/trending/cluster";

/** One story the brief has covered, and when. */
export type RememberedStory = {
  /** The headline it was covered under. Matching is fuzzy — see above. */
  title: string;
  /** ISO timestamp of the first brief that covered it. */
  firstBriefedAt: string;
  /** ISO timestamp of the most recent one. */
  lastBriefedAt: string;
};

/**
 * How long a story stays in memory. Four days covers a working week's worth of
 * "this is still going" without letting a story the reader has plainly
 * forgotten come back as "you saw this before".
 */
export const MEMORY_MAX_AGE_DAYS = 4;

/**
 * Ceiling on remembered stories. The memory rides along on the stored brief
 * row, so it has to stay small; a few days of leads and desks is well inside
 * this, and the oldest are the first to go.
 */
export const MEMORY_MAX_STORIES = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse whatever is on the row into a memory, discarding anything malformed. */
export function parseStoryMemory(raw: unknown): RememberedStory[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is RememberedStory =>
      !!s &&
      typeof s === "object" &&
      typeof (s as RememberedStory).title === "string" &&
      typeof (s as RememberedStory).firstBriefedAt === "string" &&
      typeof (s as RememberedStory).lastBriefedAt === "string",
  );
}

/**
 * The remembered story this title refers to, if any.
 *
 * Best match rather than first match: two remembered stories can both clear
 * the threshold when a big story has spawned a follow-up, and "the one it most
 * resembles" is the one whose timeline the reader is actually being reminded
 * of.
 */
export function matchRemembered(
  title: string,
  memory: RememberedStory[],
): RememberedStory | null {
  const shingles = titleShingles(title);
  if (shingles.size === 0) return null;
  let best: RememberedStory | null = null;
  let bestScore = TITLE_SHINGLE_THRESHOLD;
  for (const story of memory) {
    const score = jaccard(shingles, titleShingles(story.title));
    if (score >= bestScore) {
      best = story;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How to describe the gap since a story was first briefed, in the words a
 * person would use. Returns null when the story was first covered by the brief
 * being written right now — there is no continuity to claim.
 */
export function continuingSince(story: RememberedStory, now: Date = new Date()): string | null {
  const first = new Date(story.firstBriefedAt).getTime();
  if (Number.isNaN(first)) return null;
  const days = Math.floor((now.getTime() - first) / DAY_MS);
  if (days < 1) return null;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Fold the stories a brief just covered into the memory.
 *
 * A story already remembered keeps its `firstBriefedAt` — that date is the
 * whole point, since "running since Tuesday" is what makes the continuity
 * worth stating — and has its `lastBriefedAt` moved forward. Anything not seen
 * inside the window drops out.
 */
export function mergeStoryMemory(
  memory: RememberedStory[],
  covered: string[],
  now: Date = new Date(),
): RememberedStory[] {
  const cutoff = now.getTime() - MEMORY_MAX_AGE_DAYS * DAY_MS;
  const iso = now.toISOString();
  const kept = memory.filter((s) => {
    const last = new Date(s.lastBriefedAt).getTime();
    return !Number.isNaN(last) && last >= cutoff;
  });

  for (const title of covered) {
    if (!title.trim()) continue;
    const existing = matchRemembered(title, kept);
    if (existing) {
      existing.lastBriefedAt = iso;
      continue;
    }
    kept.push({ title, firstBriefedAt: iso, lastBriefedAt: iso });
  }

  // Newest first, then truncate: if the cap has to bite, the stories worth
  // losing are the ones the brief has not mentioned in days.
  return kept
    .sort((a, b) => (a.lastBriefedAt < b.lastBriefedAt ? 1 : -1))
    .slice(0, MEMORY_MAX_STORIES);
}

/**
 * The `[n]` numbers a finished brief actually cited.
 *
 * Read back out of the markdown because that is the only place the truth
 * lives: the plan says which refs a section MAY cite, the model decides which
 * it does, and remembering the candidates it passed over would have the brief
 * claiming to have told you things it never mentioned.
 */
export function citedRefs(content: string): number[] {
  const out = new Set<number>();
  for (const m of content.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** The titles a finished brief covered, resolved against its source map. */
export function coveredTitles(
  content: string,
  sources: { n: number; title: string }[],
): string[] {
  const byRef = new Map(sources.map((s) => [s.n, s.title]));
  return citedRefs(content)
    .map((n) => byRef.get(n))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

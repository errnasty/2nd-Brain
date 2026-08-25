/**
 * Stories the reader asked to stay on.
 *
 * ## Following a story, not a desk
 *
 * Desks are the only subscription the brief had, and they are the wrong grain
 * for most of what people actually care about. "I want to know how the Nexperia
 * seizure resolves" is not a desk — it is one story, it will be over in a
 * fortnight, and creating a desk for it means remembering to delete the desk.
 * So the brief's own memory already tracked stories across days
 * (`story-memory.ts`); it just had no way to be told which one mattered.
 *
 * This is that: a marker becomes a subscription. A followed story outranks
 * every inferred signal in selection, so it stays in the queue even on a day
 * when nothing new happened to it and the trend score has decayed to nothing —
 * which is exactly the day a reader following it wants to be told "still no
 * movement" rather than silently dropped.
 *
 * ## Matching, and why it is the same machinery as memory
 *
 * A story is remembered by roughly what it is called, matched on normalized
 * title shingles at the clustering threshold — see the long note in
 * `story-memory.ts` for why cluster ids cannot be used and why fuzzy title
 * matching is the honest choice. Following reuses that exactly, so "you are
 * following this" and "you were briefed on this" always agree about what
 * counts as the same story.
 *
 * ## It expires
 *
 * A follow is about a live story, and live stories end. Left forever, a
 * fortnight of follows becomes a second set of desks the reader never chose and
 * cannot remember creating — the precise failure this feature exists to avoid.
 * So a follow lapses if the story stops appearing, and the reader is told when
 * it does rather than discovering it silently stopped.
 *
 * Pure and storage-agnostic: the list rides in the user's settings blob.
 */

import { TITLE_SHINGLE_THRESHOLD, jaccard, titleShingles } from "@/lib/trending/cluster";

export type FollowedStory = {
  /** The headline it was followed under. Matching is fuzzy — see above. */
  title: string;
  /** ISO timestamp of when the reader asked to follow it. */
  followedAt: string;
  /** ISO timestamp of the last brief its story appeared in. */
  lastSeenAt: string;
};

/**
 * Days a follow survives without the story appearing at all.
 *
 * Long enough to ride out a quiet weekend on a story that is still running,
 * short enough that a story which simply ended stops occupying a slot. The
 * reader is never asked to tidy up.
 */
export const FOLLOW_MAX_QUIET_DAYS = 10;

/**
 * Ceiling on concurrent follows. Small on purpose: this is "the two or three
 * things I am actually tracking", and a reader with twenty of them has built
 * the unrememberable list the expiry above exists to prevent.
 */
export const MAX_FOLLOWED_STORIES = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Validate whatever is in the settings blob. Never throws. */
export function normalizeFollowedStories(v: unknown, now: Date = new Date()): FollowedStory[] {
  if (!Array.isArray(v)) return [];
  const out: FollowedStory[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Partial<FollowedStory>;
    const title = typeof f.title === "string" ? f.title.trim().slice(0, 300) : "";
    if (!title || seen.has(title.toLowerCase())) continue;
    const followedAt = isoOr(f.followedAt, now);
    const lastSeenAt = isoOr(f.lastSeenAt, new Date(followedAt));
    if (isLapsed({ title, followedAt, lastSeenAt }, now)) continue;
    seen.add(title.toLowerCase());
    out.push({ title, followedAt, lastSeenAt });
    if (out.length >= MAX_FOLLOWED_STORIES) break;
  }
  return out;
}

function isoOr(v: unknown, fallback: Date): string {
  if (typeof v === "string" && Number.isFinite(Date.parse(v))) return v;
  return fallback.toISOString();
}

/** Whether a follow has gone quiet for long enough to drop. */
export function isLapsed(f: FollowedStory, now: Date = new Date()): boolean {
  const seen = Date.parse(f.lastSeenAt);
  if (!Number.isFinite(seen)) return false;
  return now.getTime() - seen > FOLLOW_MAX_QUIET_DAYS * DAY_MS;
}

/** The follow this title belongs to, or null. Same measure as story memory. */
export function matchFollowed(title: string, followed: FollowedStory[]): FollowedStory | null {
  if (followed.length === 0) return null;
  const shingles = titleShingles(title);
  if (shingles.size === 0) return null;
  let best: FollowedStory | null = null;
  let bestScore = 0;
  for (const f of followed) {
    const score = jaccard(shingles, titleShingles(f.title));
    if (score >= TITLE_SHINGLE_THRESHOLD && score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** A predicate for the selector, built once per request. */
export function followMatcher(followed: FollowedStory[]): (title: string) => boolean {
  if (followed.length === 0) return () => false;
  return (title: string) => matchFollowed(title, followed) !== null;
}

/**
 * Start following a story, or refresh one already followed.
 *
 * Refreshing rather than duplicating matters: the reader taps "keep me on this"
 * on whichever telling is in front of them, and two tellings of one story must
 * not become two follows competing for the same slot.
 */
export function addFollow(
  followed: FollowedStory[],
  title: string,
  now: Date = new Date(),
): FollowedStory[] {
  const trimmed = title.trim().slice(0, 300);
  if (!trimmed) return followed;
  const existing = matchFollowed(trimmed, followed);
  const iso = now.toISOString();
  if (existing) {
    return followed.map((f) => (f === existing ? { ...f, lastSeenAt: iso } : f));
  }
  const entry = { title: trimmed, followedAt: iso, lastSeenAt: iso };
  if (followed.length < MAX_FOLLOWED_STORIES) return [...followed, entry];
  // Full: the oldest goes. The reader's most recent interest is the one they
  // meant, and the alternative is a tap that silently does nothing.
  const oldest = followed.reduce((a, b) =>
    Date.parse(a.followedAt) <= Date.parse(b.followedAt) ? a : b,
  );
  return [...followed.filter((f) => f !== oldest), entry];
}

/** Stop following whatever matches this title. */
export function removeFollow(followed: FollowedStory[], title: string): FollowedStory[] {
  const existing = matchFollowed(title, followed);
  return existing ? followed.filter((f) => f !== existing) : followed;
}

/**
 * Mark every follow that turned up in today's queue as still alive, and drop
 * the ones that have gone quiet past the limit.
 *
 * Called once per brief with the titles the brief actually saw, so a follow's
 * clock is reset by the story existing rather than by the reader doing
 * anything about it.
 */
export function touchFollows(
  followed: FollowedStory[],
  seenTitles: string[],
  now: Date = new Date(),
): { followed: FollowedStory[]; lapsed: FollowedStory[] } {
  const iso = now.toISOString();
  const refreshed = followed.map((f) => {
    const stillHere = seenTitles.some(
      (t) => jaccard(titleShingles(t), titleShingles(f.title)) >= TITLE_SHINGLE_THRESHOLD,
    );
    return stillHere ? { ...f, lastSeenAt: iso } : f;
  });
  return {
    followed: refreshed.filter((f) => !isLapsed(f, now)),
    lapsed: refreshed.filter((f) => isLapsed(f, now)),
  };
}

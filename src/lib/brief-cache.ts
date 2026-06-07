// Server-side cache for a generated Daily Brief, keyed by the unread-set
// fingerprint + the system prompt. If the unread set hasn't changed, a reload
// (or a second device) reuses the brief instead of paying for the model again.
// Explicit "Regenerate" bypasses this (the route passes force).
//
// In-memory per serverless instance — same caveat as map-cache: a different
// instance won't have the entry, and the TTL bounds staleness.

type CachedBrief = {
  at: number;
  content: string;
  sourceMap: unknown;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
};

const cache = new Map<string, CachedBrief>();
const TTL_MS = 24 * 60 * 60 * 1000; // a brief is a daily artifact
const MAX_ENTRIES = 500;

export function getCachedBrief(key: string): CachedBrief | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e;
}

export function setCachedBrief(key: string, value: Omit<CachedBrief, "at">): void {
  // Cheap bound: drop the oldest entry when full.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ...value, at: Date.now() });
}

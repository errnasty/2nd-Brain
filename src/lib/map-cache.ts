// Server-side cache for the full knowledge-map payload. /api/map rebuilds the
// whole graph (all items + tags + folders + links) per request — heaviest read
// in the app. Cache the built JSON per user; bust on any directory write.
//
// On Railway this is one long-lived process, so the cache and the writes that
// bust it share memory and the explicit bust is authoritative. The TTL is kept
// as the backstop for the cases it cannot see: a second replica, or a desktop
// client whose sync wrote directly to the database.

type Entry = { at: number; json: unknown };
const cache = new Map<string, Entry>();
const TTL_MS = 60_000;

export function getCachedMap(userId: string): unknown | null {
  const e = cache.get(userId);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return e.json;
}

export function setCachedMap(userId: string, json: unknown): void {
  cache.set(userId, { at: Date.now(), json });
}

/** Invalidate after a directory write so the next /api/map rebuilds. */
export function bustMapCache(userId: string): void {
  cache.delete(userId);
}

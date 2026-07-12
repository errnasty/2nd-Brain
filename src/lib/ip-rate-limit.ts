/**
 * Fixed-window in-memory rate limiter keyed by an arbitrary string (an IP,
 * an IP+route pair, …) for surfaces that have NO authenticated user yet —
 * the DB-backed `checkRateLimit` can't be used there because `rate_limits`
 * FKs onto profiles.
 *
 * In-memory means per-instance: on serverless hosts each warm instance
 * counts separately and cold starts reset the window. That is acceptable
 * for its purpose (brute-force friction on the invite code), not a hard
 * quota. Entries are pruned lazily on access.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_ENTRIES = 10_000; // hard cap so a spray of unique keys can't balloon memory

export function checkIpRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): { allowed: boolean } {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_ENTRIES) {
      // Drop expired entries first; if still over cap, reject conservatively
      // rather than letting the map grow unbounded.
      for (const [k, w] of windows) {
        if (w.resetAt <= now) windows.delete(k);
      }
      if (windows.size >= MAX_ENTRIES) return { allowed: false };
    }
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true };
  }

  existing.count += 1;
  return { allowed: existing.count <= limit };
}

/** Client IP from proxy headers; "unknown" groups direct/headerless traffic. */
export function requestIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

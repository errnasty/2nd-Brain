"use client";

/**
 * Per-device cache of simplified articles.
 *
 * Same reasoning as the translation cache in `@/lib/i18n/translate-prefs`: a
 * simplified rewrite is re-derivable, so it lives in localStorage rather than
 * the database — no migration, and you only pay to simplify an article once per
 * device. Capped and evicted oldest-first so a heavy reading week can't fill
 * the origin's quota.
 */

// v2: earlier entries were stored before model output was normalized, so they
// can contain literal Markdown (`**bold**`) in the body and a paragraph of
// prose where the headline should be. Bumping the prefix retires them instead
// of serving the broken version forever on already-simplified articles.
const CACHE_PREFIX = "reader.simplified.v2.";
const CACHE_INDEX = "reader.simplified.index.v2";
const CACHE_MAX = 30;

export type CachedSimplified = { title: string; content: string };

const cacheKey = (articleId: string) => `${CACHE_PREFIX}${articleId}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_INDEX);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function getCachedSimplified(articleId: string): CachedSimplified | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(articleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSimplified;
    return typeof parsed?.content === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function putCachedSimplified(articleId: string, value: CachedSimplified): void {
  if (typeof window === "undefined") return;
  const key = cacheKey(articleId);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    while (index.length > CACHE_MAX) {
      const oldest = index.shift();
      if (oldest) localStorage.removeItem(oldest);
    }
    localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
  } catch {
    // Out of quota: drop the whole cache rather than leave it wedged, so the
    // next rewrite has room to store its result.
    try {
      for (const k of readIndex()) localStorage.removeItem(k);
      localStorage.removeItem(CACHE_INDEX);
    } catch {
      // nothing more we can do
    }
  }
}

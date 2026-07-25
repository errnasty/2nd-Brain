"use client";

/**
 * Per-device store of passages you marked while reading.
 *
 * Highlights live in localStorage rather than the database, same reasoning as
 * the translation and simplification caches: no schema migration, and the value
 * is entirely about your own re-reading. The trade-off is real and accepted —
 * highlights are per-device and best-effort. Every read and write is guarded so
 * a full or disabled store degrades to "no highlights" instead of breaking the
 * reader.
 *
 * Two caps, both evicting oldest-first: per article, so one long piece can't
 * grow without bound, and across articles, so a heavy reading month can't fill
 * the origin's quota.
 */

const PREFIX = "reader.highlights.";
const INDEX_KEY = "reader.highlights.index.v1";
const PER_ARTICLE_MAX = 20;
const ARTICLES_MAX = 50;

const keyFor = (articleId: string) => `${PREFIX}${articleId}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function getHighlights(articleId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyFor(articleId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === "string" && h.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Add a passage and return the article's highlights afterwards. Duplicates move
 * to the end rather than appearing twice — re-marking a passage you already
 * marked should be a no-op, not clutter.
 */
export function addHighlight(articleId: string, text: string): string[] {
  const trimmed = text.trim();
  if (typeof window === "undefined" || !trimmed) return getHighlights(articleId);

  const next = [...getHighlights(articleId).filter((h) => h !== trimmed), trimmed];
  while (next.length > PER_ARTICLE_MAX) next.shift();

  const key = keyFor(articleId);
  try {
    localStorage.setItem(key, JSON.stringify(next));
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    while (index.length > ARTICLES_MAX) {
      const oldest = index.shift();
      if (oldest) localStorage.removeItem(oldest);
    }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    return next;
  } catch {
    // Out of quota: drop the oldest article's highlights and try once more, so
    // the passage you just marked isn't the one that gets lost.
    try {
      const index = readIndex();
      const oldest = index.shift();
      if (oldest && oldest !== key) {
        localStorage.removeItem(oldest);
        localStorage.setItem(INDEX_KEY, JSON.stringify(index));
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      }
    } catch {
      // nothing more we can do — highlights are best-effort
    }
    return getHighlights(articleId);
  }
}

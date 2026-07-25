"use client";

import { LANGUAGE_NAMES, type LanguageCode } from "./detect-language";

/**
 * Reading-language preference + a per-device cache of translations.
 *
 * Translations are re-derivable, so they live in localStorage rather than the
 * database: it keeps a schema migration off the table and still means you only
 * pay for translating an article once per device. The cache is capped and
 * evicts oldest-first so a heavy reading week can't fill the origin's quota.
 */

const PREFS_KEY = "reader.translate.v1";
const CACHE_PREFIX = "reader.translation.";
const CACHE_INDEX = "reader.translation.index.v1";
const CACHE_MAX = 30;

export type TranslatePrefs = {
  /** Language to translate INTO. */
  target: LanguageCode;
  /** Translate foreign-language articles automatically on open. */
  auto: boolean;
};

/** Guess a sensible default from the browser before the user picks one. */
function defaultTarget(): LanguageCode {
  if (typeof navigator === "undefined") return "en";
  const tag = (navigator.language || "en").slice(0, 2).toLowerCase();
  return (tag in LANGUAGE_NAMES ? tag : "en") as LanguageCode;
}

export function getTranslatePrefs(): TranslatePrefs {
  const fallback: TranslatePrefs = { target: defaultTarget(), auto: false };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TranslatePrefs>;
    return {
      target: parsed.target && parsed.target in LANGUAGE_NAMES ? parsed.target : fallback.target,
      auto: parsed.auto === true,
    };
  } catch {
    return fallback;
  }
}

export function setTranslatePrefs(patch: Partial<TranslatePrefs>): TranslatePrefs {
  const next = { ...getTranslatePrefs(), ...patch };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // private mode / quota — the preference just won't persist
    }
  }
  return next;
}

// ── Translation cache ─────────────────────────────────────────────────

export type CachedTranslation = { title: string; content: string };

const cacheKey = (articleId: string, target: string) => `${CACHE_PREFIX}${articleId}.${target}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_INDEX);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function getCachedTranslation(articleId: string, target: string): CachedTranslation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(articleId, target));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTranslation;
    return typeof parsed?.content === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function putCachedTranslation(
  articleId: string,
  target: string,
  value: CachedTranslation,
): void {
  if (typeof window === "undefined") return;
  const key = cacheKey(articleId, target);
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
    // next translation has room to store its result.
    try {
      for (const k of readIndex()) localStorage.removeItem(k);
      localStorage.removeItem(CACHE_INDEX);
    } catch {
      // nothing more we can do
    }
  }
}

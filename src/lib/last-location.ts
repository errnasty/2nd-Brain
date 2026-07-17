"use client";

// "Resume where you left off": remember the last place the user was in each
// surface so a bare visit (e.g. clicking "Study" in the nav) restores it,
// instead of always dumping them on the default tab / All-items view.
//
// Client-only, localStorage-backed. Kept deliberately small and null-safe so a
// stale or absent value never breaks a first-time visit — callers treat a
// missing value as "no preference, use the default".

const KEYS = {
  studyTab: "resume.studyTab.v1",
  directoryFolder: "resume.directoryFolder.v1",
  directoryItem: "resume.directoryItem.v1",
  feedsArticle: "resume.feedsArticle.v1",
} as const;

type Key = keyof typeof KEYS;

function read(key: Key): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

function write(key: Key, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(KEYS[key], value);
    else localStorage.removeItem(KEYS[key]);
  } catch {
    /* private mode / quota — resume is best-effort */
  }
}

export const lastLocation = {
  getStudyTab: () => read("studyTab"),
  setStudyTab: (tab: string) => write("studyTab", tab),

  getDirectoryFolder: () => read("directoryFolder"),
  setDirectoryFolder: (folderId: string | null) => write("directoryFolder", folderId),

  getDirectoryItem: () => read("directoryItem"),
  setDirectoryItem: (itemId: string | null) => write("directoryItem", itemId),

  getFeedsArticle: () => read("feedsArticle"),
  setFeedsArticle: (articleId: string | null) => write("feedsArticle", articleId),
};

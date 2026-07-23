"use client";

// "Recently viewed" quick-access list for the Directory sidebar — the last
// few folders/items opened, independent of the single "resume" slot in
// last-location.ts. Client-only, localStorage-backed; a missing/corrupt value
// is treated as an empty list rather than an error.

export type RecentEntry = { id: string; kind: "folder" | "item"; title: string; ts: number };

const KEY = "directory.recent.v1";
const MAX = 6;

function read(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — best-effort */
  }
}

export function getRecent(): RecentEntry[] {
  return read();
}

/** Record a folder/item as just-opened, moving it to the front (deduped) and
 *  capping the list at MAX. Returns the updated list so callers can render
 *  immediately without a second read. */
export function pushRecent(entry: Omit<RecentEntry, "ts">): RecentEntry[] {
  const rest = read().filter((e) => !(e.id === entry.id && e.kind === entry.kind));
  const next = [{ ...entry, ts: Date.now() }, ...rest].slice(0, MAX);
  write(next);
  return next;
}

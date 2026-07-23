"use client";

// Saved/"Smart" views — a named, pinned combination of tag filters shown in
// the Directory sidebar like a virtual folder. Client-only, localStorage-
// backed (tags are the only cross-folder filter that already lives in the
// URL, so a view is just a name + a set of tag ids).

export type SmartView = { id: string; name: string; tagIds: string[] };

const KEY = "directory.smartViews.v1";

function read(): SmartView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SmartView[]) : [];
  } catch {
    return [];
  }
}

function write(views: SmartView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* private mode / quota — best-effort */
  }
}

export function getSmartViews(): SmartView[] {
  return read();
}

export function saveSmartView(name: string, tagIds: string[]): SmartView[] {
  const view: SmartView = { id: crypto.randomUUID(), name, tagIds };
  const next = [...read(), view];
  write(next);
  return next;
}

export function deleteSmartView(id: string): SmartView[] {
  const next = read().filter((v) => v.id !== id);
  write(next);
  return next;
}

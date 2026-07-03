// Offline flashcard-grade queue. Grades are tiny and idempotent-ish (a replay
// just reschedules the card from its then-current state), so localStorage is
// enough — no Dexie schema bump needed. Flushed on reconnect / next mount.

const KEY = "review.pendingGrades.v1";

export type PendingGrade = { id: string; quality: number; at: string };

function read(): PendingGrade[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingGrade[]) : [];
  } catch {
    return [];
  }
}

function write(grades: PendingGrade[]): void {
  try {
    if (grades.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(grades));
  } catch {
    // quota — drop silently; the card will simply come due again
  }
}

export function enqueueGrade(id: string, quality: number): void {
  write([...read(), { id, quality, at: new Date().toISOString() }]);
}

export function pendingGradeCount(): number {
  return read().length;
}

/**
 * Replay queued grades in order through `gradeFn`. Stops at the first network
 * failure (still offline) keeping the remainder queued; drops grades the
 * server explicitly rejects (card deleted, invalid) so they can't wedge the
 * queue forever. Returns how many synced.
 */
export async function flushGrades(
  gradeFn: (g: { id: string; quality: number }) => Promise<{ ok: boolean }>,
): Promise<number> {
  let queue = read();
  let synced = 0;
  while (queue.length > 0) {
    const g = queue[0];
    try {
      await gradeFn({ id: g.id, quality: g.quality });
      synced++;
    } catch {
      break; // network — retry on next flush
    }
    queue = queue.slice(1);
    write(queue);
  }
  return synced;
}

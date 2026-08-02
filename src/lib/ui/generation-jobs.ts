/**
 * A tiny store of "AI work in progress right now", so the app can show it
 * somewhere other than the button that started it.
 *
 * ## Why this exists
 *
 * Quiz and flashcard generation both take several seconds, and both are
 * started from a menu, a bulk bar, or a dialog that closes — then the app
 * navigates away. A spinner inside the button therefore disappears almost
 * immediately, and a toast is easy to miss. There was no way to answer "is it
 * still working, or did it fail?".
 *
 * ## Why a store and not a window event
 *
 * `route-progress.tsx` broadcasts window CustomEvents, which is the right
 * shape for one boolean. This carries a LIST with per-job progress counts that
 * arrive over time, and a late subscriber (the status strip mounting after a
 * navigation) has to see jobs that started before it. Events have no state to
 * catch up on; this does.
 *
 * Deliberately module-level rather than React context: the jobs outlive the
 * component that started them, including across route changes, and the status
 * strip lives in the app layout where a provider would re-render every page on
 * every progress tick.
 */

export type GenerationJob = {
  id: string;
  /** What is being made — "Building quiz", "Making flashcards". */
  label: string;
  /** Units finished. Meaningless when `total` is 0. */
  done: number;
  /** Total units, or 0 when the work reports no progress (indeterminate). */
  total: number;
};

// The single snapshot reference. useSyncExternalStore compares snapshots by
// identity and re-renders forever if getSnapshot builds a new array each call,
// so this is replaced only inside `emit`.
let jobs: GenerationJob[] = [];
const EMPTY: GenerationJob[] = [];

const listeners = new Set<() => void>();

function emit(next: GenerationJob[]): void {
  jobs = next;
  for (const l of listeners) l();
}

export function subscribeGenerationJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGenerationJobs(): GenerationJob[] {
  return jobs;
}

/** Server render has no in-flight work — a stable empty array, never `jobs`,
 *  so hydration can't mismatch on a job that started before hydration. */
export function getServerGenerationJobs(): GenerationJob[] {
  return EMPTY;
}

let seq = 0;

/** Register a new job. Returns its id, for `updateJob` / `finishJob`. */
export function startGenerationJob(label: string, total = 0): string {
  const id = `job-${++seq}`;
  emit([...jobs, { id, label, done: 0, total }]);
  return id;
}

export function updateGenerationJob(id: string, patch: Partial<Omit<GenerationJob, "id">>): void {
  const i = jobs.findIndex((j) => j.id === id);
  if (i === -1) return;
  const next = jobs.slice();
  next[i] = { ...next[i], ...patch };
  emit(next);
}

/** Remove a job. Safe to call twice — a `finally` and an error path both may. */
export function finishGenerationJob(id: string): void {
  if (!jobs.some((j) => j.id === id)) return;
  emit(jobs.filter((j) => j.id !== id));
}

/** Run `fn` with a job visible for its duration, cleared however it ends. */
export async function withGenerationJob<T>(
  label: string,
  fn: (job: { id: string; update: (patch: Partial<Omit<GenerationJob, "id">>) => void }) => Promise<T>,
  total = 0,
): Promise<T> {
  const id = startGenerationJob(label, total);
  try {
    return await fn({ id, update: (patch) => updateGenerationJob(id, patch) });
  } finally {
    finishGenerationJob(id);
  }
}

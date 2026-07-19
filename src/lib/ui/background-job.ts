import { isSeveredResponse } from "@/lib/ui/severed";

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 120_000;

type JobOpts = {
  kind: "curriculum" | "gap_research";
  topic: string;
  folderId?: string | null;
  /** Abort to stop polling and drop callbacks (e.g. dialog closed). The job
   *  itself keeps running server-side — its note still lands. */
  signal?: AbortSignal;
  onDone: (itemId: string) => void;
  onError: (message: string) => void;
  /** Called when the job outlives the poll window — still running, not failed. */
  onStillWorking?: () => void;
};

/**
 * Run a long AI job without depending on any single long response: create the
 * job (fast, must succeed), kick the run route (response allowed to sever),
 * and poll the job status until it lands. This is the client half of the
 * ai_jobs pattern — a serverless timeout can never surface as a false error.
 */
export async function runBackgroundJob(opts: JobOpts): Promise<void> {
  const { signal } = opts;
  let settled = false;
  const done = (itemId: string) => {
    if (settled || signal?.aborted) return;
    settled = true;
    opts.onDone(itemId);
  };
  const fail = (message: string) => {
    if (settled || signal?.aborted) return;
    settled = true;
    opts.onError(message);
  };

  // 1. Create — the one response we truly need.
  let jobId: string;
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: opts.kind, topic: opts.topic, folderId: opts.folderId ?? null }),
      signal,
    });
    const data = await res.json();
    if (!res.ok || !data.jobId) {
      fail(data.error ?? "Couldn't start the job");
      return;
    }
    jobId = data.jobId;
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") fail(err instanceof Error ? err.message : "Couldn't start the job");
    return;
  }

  // 2. Kick — a severed response here is expected and harmless (poll covers
  // it); only an explicit job failure short-circuits.
  fetch(`/api/jobs/${jobId}/run`, { method: "POST", signal })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.itemId) done(data.itemId);
      else if (!res.ok && res.status !== 409) fail(data.error ?? "Job failed");
    })
    .catch((err) => {
      if ((err as Error)?.name === "AbortError" || isSeveredResponse(err)) return;
    });

  // 3. Poll.
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (settled || signal?.aborted) {
      clearInterval(timer);
      return;
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { signal });
      if (!res.ok) return; // transient — next tick retries
      const data = await res.json();
      if (data.status === "done" && data.itemId) {
        clearInterval(timer);
        done(data.itemId);
      } else if (data.status === "error") {
        clearInterval(timer);
        fail(data.error ?? "Job failed");
      } else if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        if (!settled && !signal?.aborted) {
          settled = true;
          opts.onStillWorking?.();
        }
      }
    } catch {
      // transient — next tick retries
    }
  }, POLL_MS);
  signal?.addEventListener("abort", () => clearInterval(timer), { once: true });
}

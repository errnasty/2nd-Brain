import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  finishGenerationJob,
  getGenerationJobs,
  getServerGenerationJobs,
  startGenerationJob,
  subscribeGenerationJobs,
  updateGenerationJob,
  withGenerationJob,
} from "./generation-jobs";

/** Clear any jobs a previous test left behind — the store is module state. */
beforeEach(() => {
  for (const j of getGenerationJobs()) finishGenerationJob(j.id);
});

describe("generation job store", () => {
  it("starts empty", () => {
    expect(getGenerationJobs()).toEqual([]);
  });

  it("tracks a job through start, update and finish", () => {
    const id = startGenerationJob("Building quiz", 12);
    expect(getGenerationJobs()).toMatchObject([{ label: "Building quiz", done: 0, total: 12 }]);
    updateGenerationJob(id, { done: 8 });
    expect(getGenerationJobs()[0]).toMatchObject({ done: 8, total: 12 });
    finishGenerationJob(id);
    expect(getGenerationJobs()).toEqual([]);
  });

  it("keeps concurrent jobs separate", () => {
    const a = startGenerationJob("Building quiz", 8);
    const b = startGenerationJob("Making flashcards");
    updateGenerationJob(a, { done: 4 });
    expect(getGenerationJobs()).toHaveLength(2);
    expect(getGenerationJobs().find((j) => j.id === a)).toMatchObject({ done: 4 });
    expect(getGenerationJobs().find((j) => j.id === b)).toMatchObject({ total: 0 });
    finishGenerationJob(a);
    expect(getGenerationJobs()).toMatchObject([{ label: "Making flashcards" }]);
  });

  // useSyncExternalStore compares snapshots by identity: a getSnapshot that
  // built a fresh array on every call would re-render forever. These two properties
  // are what keep that from happening.
  it("returns a stable snapshot between changes", () => {
    const id = startGenerationJob("Building quiz");
    expect(getGenerationJobs()).toBe(getGenerationJobs());
    updateGenerationJob(id, { done: 1 });
    expect(getGenerationJobs()).toBe(getGenerationJobs());
  });

  it("returns a new snapshot on every change", () => {
    const before = getGenerationJobs();
    const id = startGenerationJob("Building quiz");
    const afterStart = getGenerationJobs();
    expect(afterStart).not.toBe(before);
    updateGenerationJob(id, { done: 2 });
    expect(getGenerationJobs()).not.toBe(afterStart);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGenerationJobs(listener);
    const id = startGenerationJob("Building quiz");
    updateGenerationJob(id, { done: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    finishGenerationJob(id);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores updates and finishes for unknown ids", () => {
    const listener = vi.fn();
    subscribeGenerationJobs(listener);
    updateGenerationJob("nope", { done: 5 });
    finishGenerationJob("nope");
    expect(listener).not.toHaveBeenCalled();
    expect(getGenerationJobs()).toEqual([]);
  });

  // A double finish happens naturally: an error path and a `finally` both call it.
  it("is safe to finish twice", () => {
    const id = startGenerationJob("Building quiz");
    finishGenerationJob(id);
    finishGenerationJob(id);
    expect(getGenerationJobs()).toEqual([]);
  });

  it("never reports in-flight work for the server snapshot", () => {
    startGenerationJob("Building quiz");
    expect(getServerGenerationJobs()).toEqual([]);
  });
});

describe("withGenerationJob", () => {
  it("clears the job when the work succeeds", async () => {
    const result = await withGenerationJob("Making flashcards", async () => {
      expect(getGenerationJobs()).toHaveLength(1);
      return "done";
    });
    expect(result).toBe("done");
    expect(getGenerationJobs()).toEqual([]);
  });

  // Without this the strip would sit there forever after any failure.
  it("clears the job when the work throws", async () => {
    await expect(
      withGenerationJob("Making flashcards", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getGenerationJobs()).toEqual([]);
  });

  it("exposes an update handle for progress", async () => {
    await withGenerationJob(
      "Building quiz",
      async ({ update }) => {
        update({ done: 3 });
        expect(getGenerationJobs()[0]).toMatchObject({ done: 3, total: 9 });
      },
      9,
    );
  });
});

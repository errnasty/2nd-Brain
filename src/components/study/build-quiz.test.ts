import { describe, expect, it, vi, beforeEach } from "vitest";

const generateQuizAction = vi.fn();
const continueQuizAction = vi.fn();

vi.mock("@/app/(app)/study/quiz-actions", () => ({
  generateQuizAction: (...a: unknown[]) => generateQuizAction(...a),
  continueQuizAction: (...a: unknown[]) => continueQuizAction(...a),
}));

const { buildQuiz } = await import("./build-quiz");
const { getGenerationJobs } = await import("@/lib/ui/generation-jobs");

/** A successful step result. */
const step = (count: number, total: number, done = count >= total) => ({
  ok: true as const,
  id: "quiz-1",
  count,
  total,
  done,
});

beforeEach(() => {
  generateQuizAction.mockReset();
  continueQuizAction.mockReset();
});

describe("buildQuiz", () => {
  it("returns immediately when the first batch already fills the quiz", async () => {
    generateQuizAction.mockResolvedValue(step(4, 4));
    const r = await buildQuiz(["a"]);
    expect(r).toMatchObject({ ok: true, id: "quiz-1", count: 4, total: 4 });
    expect(continueQuizAction).not.toHaveBeenCalled();
  });

  it("walks batches until the quiz is full", async () => {
    generateQuizAction.mockResolvedValue(step(4, 12));
    continueQuizAction
      .mockResolvedValueOnce(step(8, 12))
      .mockResolvedValueOnce(step(12, 12));
    const r = await buildQuiz(["a"]);
    expect(continueQuizAction).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, count: 12 });
  });

  it("reports progress after every batch", async () => {
    generateQuizAction.mockResolvedValue(step(4, 12));
    continueQuizAction.mockResolvedValueOnce(step(8, 12)).mockResolvedValueOnce(step(12, 12));
    const seen: number[] = [];
    await buildQuiz(["a"], { onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([4, 8, 12]);
  });

  it("propagates a first-step failure — there is no quiz to keep", async () => {
    generateQuizAction.mockResolvedValue({ ok: false, error: "no text to quiz on" });
    expect(await buildQuiz(["a"])).toEqual({ ok: false, error: "no text to quiz on" });
    expect(continueQuizAction).not.toHaveBeenCalled();
  });

  // The point of batching: the quiz exists and is takeable from the first batch
  // on, so a later failure shortens it rather than losing it.
  it("keeps the questions already written when a later batch fails", async () => {
    generateQuizAction.mockResolvedValue(step(4, 12));
    continueQuizAction
      .mockResolvedValueOnce(step(8, 12))
      .mockResolvedValueOnce({ ok: false, error: "rate limited" });
    const r = await buildQuiz(["a"]);
    expect(r).toMatchObject({ ok: true, id: "quiz-1", count: 8 });
  });

  it("stops when a batch adds nothing, instead of looping", async () => {
    generateQuizAction.mockResolvedValue(step(4, 12));
    continueQuizAction.mockResolvedValue(step(4, 12, false)); // never progresses
    const r = await buildQuiz(["a"]);
    expect(continueQuizAction).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, count: 4 });
  });

  // A model that returns one fewer question than asked on every call must not
  // be able to spin requests forever.
  it("gives up after a bounded number of rounds", async () => {
    generateQuizAction.mockResolvedValue(step(1, 20, false));
    let n = 1;
    continueQuizAction.mockImplementation(async () => step(++n, 20, false));
    const r = await buildQuiz(["a"]);
    expect(continueQuizAction.mock.calls.length).toBeLessThanOrEqual(8);
    expect(r).toMatchObject({ ok: true });
  });

  it("carries the XP award from the creating step", async () => {
    generateQuizAction.mockResolvedValue({ ...step(4, 8), xp: { gained: 20 } });
    continueQuizAction.mockResolvedValue(step(8, 8));
    const r = await buildQuiz(["a"]);
    expect(r).toMatchObject({ ok: true, xp: { gained: 20 } });
  });
});

describe("buildQuiz progress reporting", () => {
  // The strip lives in the app layout and outlives the caller, so a job that
  // is never cleared sits on screen forever.
  it("clears its generation job when the build finishes", async () => {
    generateQuizAction.mockResolvedValue(step(4, 8));
    continueQuizAction.mockResolvedValue(step(8, 8));
    await buildQuiz(["a"]);
    expect(getGenerationJobs()).toEqual([]);
  });

  it("clears its generation job when the first step fails", async () => {
    generateQuizAction.mockResolvedValue({ ok: false, error: "nope" });
    await buildQuiz(["a"]);
    expect(getGenerationJobs()).toEqual([]);
  });

  it("clears its generation job when an action throws", async () => {
    generateQuizAction.mockRejectedValue(new Error("network"));
    await expect(buildQuiz(["a"])).rejects.toThrow("network");
    expect(getGenerationJobs()).toEqual([]);
  });

  it("publishes progress to the store while building", async () => {
    generateQuizAction.mockResolvedValue(step(4, 8));
    continueQuizAction.mockImplementation(async () => {
      // Mid-build the job should be visible with the first batch's count.
      expect(getGenerationJobs()).toMatchObject([{ label: "Building quiz", done: 4, total: 8 }]);
      return step(8, 8);
    });
    await buildQuiz(["a"]);
    expect(continueQuizAction).toHaveBeenCalled();
  });
});

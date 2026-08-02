import { describe, expect, it, vi, beforeEach } from "vitest";

const generateQuizAction = vi.fn();
const continueQuizAction = vi.fn();

vi.mock("@/app/(app)/study/quiz-actions", () => ({
  generateQuizAction: (...a: unknown[]) => generateQuizAction(...a),
  continueQuizAction: (...a: unknown[]) => continueQuizAction(...a),
}));

const { buildQuiz, quizReadyMessage } = await import("./build-quiz");
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

  // A batch that returns nothing usable is common (the model repeats a
  // question, or emits options that fail validation), and treating the first
  // one as "finished" is what turned a 10-question setting into 7.
  it("retries a stalled batch instead of settling immediately", async () => {
    generateQuizAction.mockResolvedValue(step(4, 10));
    continueQuizAction
      .mockResolvedValueOnce({ ...step(4, 10, false), stalled: true }) // nothing usable
      .mockResolvedValueOnce(step(8, 10))
      .mockResolvedValueOnce(step(10, 10));
    const r = await buildQuiz(["a"]);
    expect(r).toMatchObject({ ok: true, count: 10 });
  });

  it("gives up after repeated stalls rather than looping", async () => {
    generateQuizAction.mockResolvedValue(step(4, 12));
    continueQuizAction.mockResolvedValue({ ...step(4, 12, false), stalled: true });
    const r = await buildQuiz(["a"]);
    expect(continueQuizAction).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, count: 4 });
  });

  // A model that returns one fewer question than asked on every call must not
  // be able to spin requests forever. The exact ceiling is a tuning constant;
  // what matters is that the loop terminates well short of unbounded.
  it("gives up after a bounded number of rounds", async () => {
    generateQuizAction.mockResolvedValue(step(1, 20, false));
    let n = 1;
    continueQuizAction.mockImplementation(async () => step(++n, 20, false));
    const r = await buildQuiz(["a"]);
    expect(continueQuizAction.mock.calls.length).toBeLessThanOrEqual(12);
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

describe("quizReadyMessage", () => {
  it("names the shortfall so a capped quiz doesn't look like an ignored setting", () => {
    expect(quizReadyMessage({ count: 7, total: 10 })).toBe("Quiz ready — 7 of 10 questions");
  });

  it("stays plain when the full count was delivered", () => {
    expect(quizReadyMessage({ count: 10, total: 10 })).toBe("Quiz ready — 10 questions");
  });

  it("uses the singular for one question", () => {
    expect(quizReadyMessage({ count: 1, total: 1 })).toBe("Quiz ready — 1 question");
  });
});

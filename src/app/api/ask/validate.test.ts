import { describe, expect, it, vi } from "vitest";
import { validateAskBody, withTimeout, TimeoutError } from "./validate";

describe("validateAskBody (zero-token safety)", () => {
  it("rejects empty-string question with 400", () => {
    const r = validateAskBody({ question: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects whitespace-only question with 400", () => {
    const r = validateAskBody({ question: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects missing question with 400", () => {
    const r = validateAskBody({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects non-object body with 400", () => {
    expect(validateAskBody(null).ok).toBe(false);
    expect(validateAskBody("hi").ok).toBe(false);
    expect(validateAskBody(undefined).ok).toBe(false);
  });

  it("rejects non-string question with 400", () => {
    expect(validateAskBody({ question: 42 }).ok).toBe(false);
  });

  it("accepts a real question and trims it", () => {
    const r = validateAskBody({ question: "  what did I save about AI?  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.question).toBe("what did I save about AI?");
  });
});

describe("withTimeout (provider stall graceful catch)", () => {
  it("rejects with TimeoutError when the promise outlasts the budget", async () => {
    vi.useFakeTimers();
    // A 10s stall vs an 8s budget — must reject, not hang.
    const stall = new Promise((resolve) => setTimeout(resolve, 10_000));
    const raced = withTimeout(stall, 8000, "streamText");
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    vi.useRealTimers();
  });

  it("resolves with the value when the promise beats the budget", async () => {
    vi.useFakeTimers();
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 100));
    const raced = withTimeout(fast, 8000);
    await vi.advanceTimersByTimeAsync(100);
    await expect(raced).resolves.toBe("ok");
    vi.useRealTimers();
  });

  it("clears its timer so a resolved race leaves nothing pending", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const fast = Promise.resolve("done");
    await withTimeout(fast, 8000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    vi.useRealTimers();
  });
});

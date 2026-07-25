import { describe, expect, it } from "vitest";

/**
 * Mirrors the pull-to-advance accumulator in ArticleReader (continuous
 * reading). Kept as a pure function here so the *decision* logic — when does
 * scrolling past the end open the next article — is testable without a DOM.
 * The component wires the same rules to wheel/touch events.
 */
const PULL_TO_ADVANCE = 160;

type PullState = { pull: number; advanced: boolean };

function addPull(
  state: PullState,
  dy: number,
  opts: { atBottom: boolean; hasNext: boolean },
): PullState {
  if (state.advanced) return state;
  if (dy <= 0 || !opts.atBottom || !opts.hasNext) return state;
  const pull = state.pull + dy;
  if (pull >= PULL_TO_ADVANCE) return { pull: 0, advanced: true };
  return { pull, advanced: false };
}

const fresh = (): PullState => ({ pull: 0, advanced: false });

describe("pull-to-advance (continuous reading)", () => {
  it("does not advance merely by reaching the bottom", () => {
    const s = addPull(fresh(), 0, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(false);
    expect(s.pull).toBe(0);
  });

  it("ignores scrolling while the article still has content below", () => {
    let s = fresh();
    for (let i = 0; i < 20; i++) s = addPull(s, 50, { atBottom: false, hasNext: true });
    expect(s.advanced).toBe(false);
    expect(s.pull).toBe(0);
  });

  it("advances once a deliberate pull past the end accumulates", () => {
    let s = fresh();
    s = addPull(s, 80, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(false);
    s = addPull(s, 80, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(true);
  });

  it("needs more than a single small nudge at the bottom", () => {
    const s = addPull(fresh(), 20, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(false);
  });

  it("ignores upward scrolling (reading back over the end)", () => {
    let s = fresh();
    for (let i = 0; i < 20; i++) s = addPull(s, -50, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(false);
  });

  it("never advances past the last article", () => {
    let s = fresh();
    for (let i = 0; i < 20; i++) s = addPull(s, 100, { atBottom: true, hasNext: false });
    expect(s.advanced).toBe(false);
  });

  it("only fires once per article, however far the reader keeps pulling", () => {
    let s = fresh();
    s = addPull(s, PULL_TO_ADVANCE, { atBottom: true, hasNext: true });
    expect(s.advanced).toBe(true);
    const after = addPull(s, 500, { atBottom: true, hasNext: true });
    expect(after).toBe(s); // unchanged — no double-skip
  });
});

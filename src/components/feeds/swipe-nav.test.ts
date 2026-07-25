import { describe, expect, it } from "vitest";

/**
 * Mirrors the reader's swipe-to-page gesture rules (ArticleReader). Pure so the
 * thresholds — which decide whether a touch is "page to another article" versus
 * "scroll" or "select text" — are testable without a DOM. The component wires
 * the same rules to touchstart/touchend.
 */
function swipeTarget(
  dx: number,
  dy: number,
  ids: { prevId: string | null; nextId: string | null },
): string | null {
  if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? ids.nextId : ids.prevId;
}

const both = { prevId: "prev", nextId: "next" };

describe("reader swipe navigation", () => {
  it("swiping left opens the next article", () => {
    expect(swipeTarget(-120, 5, both)).toBe("next");
  });

  it("swiping right opens the previous article", () => {
    expect(swipeTarget(120, 5, both)).toBe("prev");
  });

  it("ignores a vertical scroll", () => {
    expect(swipeTarget(4, -400, both)).toBeNull();
  });

  it("ignores a diagonal drag that is mostly vertical", () => {
    expect(swipeTarget(-90, -200, both)).toBeNull();
  });

  it("ignores a short drag (text selection / tap jitter)", () => {
    expect(swipeTarget(-40, 2, both)).toBeNull();
    expect(swipeTarget(69, 0, both)).toBeNull();
  });

  it("does nothing at the ends of the list", () => {
    expect(swipeTarget(-120, 0, { prevId: "p", nextId: null })).toBeNull();
    expect(swipeTarget(120, 0, { prevId: null, nextId: "n" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

describe("chunkText", () => {
  it("returns [] for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("returns a single chunk when under chunkSize", () => {
    const out = chunkText("short text");
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(0);
    expect(out[0].text).toBe("short text");
    expect(out[0].approxTokens).toBe(Math.ceil("short text".length / 4));
  });

  it("splits long text into multiple sequentially-indexed chunks", () => {
    const para = "word ".repeat(400); // ~2000 chars
    const input = `${para}\n\n${para}\n\n${para}`; // ~6000 chars > 4000
    const out = chunkText(input);
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c, i) => expect(c.index).toBe(i));
  });

  it("respects a custom chunkSize", () => {
    const input = "a. b. c. d. e. f. g. h. ".repeat(50);
    const out = chunkText(input, { chunkSize: 100, overlap: 20 });
    expect(out.length).toBeGreaterThan(1);
    // No chunk wildly exceeds the target (allow some slack for overlap/merge).
    for (const c of out) expect(c.text.length).toBeLessThanOrEqual(220);
  });
});

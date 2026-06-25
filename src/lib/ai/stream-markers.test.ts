import { describe, expect, it } from "vitest";
import { displayText, firstSentinel, USAGE_SENTINEL, WEBSOURCES_SENTINEL, BRIEFSOURCES_SENTINEL } from "./stream-markers";

describe("firstSentinel", () => {
  it("returns -1 when no sentinel present", () => {
    expect(firstSentinel("just some answer text")).toBe(-1);
  });
  it("finds a complete sentinel's index", () => {
    expect(firstSentinel(`x${USAGE_SENTINEL}{}`)).toBe(1);
  });
  it("returns the EARLIEST of several sentinels", () => {
    const acc = `answer${WEBSOURCES_SENTINEL}[]${USAGE_SENTINEL}{}`;
    expect(firstSentinel(acc)).toBe("answer".length);
  });
});

describe("displayText", () => {
  it("passes through text with no markers", () => {
    expect(displayText("hello world")).toBe("hello world");
  });

  it("cuts at the first complete sentinel", () => {
    expect(displayText(`the answer${USAGE_SENTINEL}{"t":1}`)).toBe("the answer");
    expect(displayText(`the answer${BRIEFSOURCES_SENTINEL}[]`)).toBe("the answer");
  });

  it("hides a trailing PARTIAL sentinel so it never flashes mid-stream", () => {
    // "<<<SB_US" is a prefix of USAGE_SENTINEL split across chunks.
    expect(displayText("answer<<<SB_US")).toBe("answer");
    expect(displayText("answer<<<SB_")).toBe("answer");
  });

  it("does not hide normal text that merely starts with '<'", () => {
    expect(displayText("a < b and c > d")).toBe("a < b and c > d");
  });

  it("cuts at the first when web sources precede usage", () => {
    const acc = `body${WEBSOURCES_SENTINEL}[{"u":"x"}]${USAGE_SENTINEL}{"t":2}`;
    expect(displayText(acc)).toBe("body");
  });
});

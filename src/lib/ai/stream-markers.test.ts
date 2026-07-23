import { describe, expect, it } from "vitest";
import {
  displayText,
  firstSentinel,
  extractFrames,
  decodeFramePayload,
  USAGE_SENTINEL,
  WEBSOURCES_SENTINEL,
  BRIEFSOURCES_SENTINEL,
  STATUS_SENTINEL,
  THINKING_SENTINEL,
  RAGSOURCES_SENTINEL,
  FRAME_END,
} from "./stream-markers";

function encodeFrame(sentinel: string, payload: unknown): string {
  return `${sentinel}${Buffer.from(JSON.stringify(payload)).toString("base64")}${FRAME_END}`;
}

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

describe("extractFrames + decodeFramePayload", () => {
  it("extracts a single complete frame and strips it from rest", () => {
    const acc = `before ${encodeFrame(STATUS_SENTINEL, { stage: "retrieving" })} after`;
    const { payloads, rest } = extractFrames(acc, STATUS_SENTINEL);
    expect(payloads).toHaveLength(1);
    expect(decodeFramePayload<{ stage: string }>(payloads[0])).toEqual({ stage: "retrieving" });
    expect(rest).toBe("before  after");
  });

  it("extracts multiple frames of the same type, interleaved with real text", () => {
    const acc = `${encodeFrame(THINKING_SENTINEL, "step one. ")}visible${encodeFrame(THINKING_SENTINEL, "step two.")}`;
    const { payloads, rest } = extractFrames(acc, THINKING_SENTINEL);
    expect(payloads.map((p) => decodeFramePayload<string>(p))).toEqual(["step one. ", "step two."]);
    expect(rest).toBe("visible");
  });

  it("holds back an unclosed frame (opener arrived, closer hasn't) without flashing raw text", () => {
    const opened = `answer${THINKING_SENTINEL}${Buffer.from('"partial').toString("base64")}`;
    const { payloads, rest } = extractFrames(opened, THINKING_SENTINEL);
    expect(payloads).toEqual([]);
    expect(rest).toBe("answer");
  });

  it("holds back a partial sentinel opener split across chunk boundaries", () => {
    const acc = "answer" + THINKING_SENTINEL.slice(0, 5);
    const { payloads, rest } = extractFrames(acc, THINKING_SENTINEL);
    expect(payloads).toEqual([]);
    expect(rest).toBe("answer");
  });

  it("completes a previously-partial frame once the rest of it arrives", () => {
    const full = encodeFrame(RAGSOURCES_SENTINEL, [{ n: 1 }]);
    const acc = full.slice(0, full.length - 5); // still missing the tail
    const first = extractFrames(acc, RAGSOURCES_SENTINEL);
    expect(first.payloads).toEqual([]);
    // more bytes arrive, completing the frame
    const acc2 = acc + full.slice(full.length - 5) + "final text";
    const second = extractFrames(acc2, RAGSOURCES_SENTINEL);
    expect(second.payloads).toHaveLength(1);
    expect(decodeFramePayload(second.payloads[0])).toEqual([{ n: 1 }]);
    expect(second.rest).toBe("final text");
  });

  it("does not confuse trailing sentinels (USAGE/WEBSOURCES) with inline frames", () => {
    const acc = `${encodeFrame(STATUS_SENTINEL, { stage: "retrieving" })}the answer${USAGE_SENTINEL}{"t":1}`;
    const { rest } = extractFrames(acc, STATUS_SENTINEL);
    // Inline frame is gone; the trailing USAGE sentinel (a different scheme)
    // passes through untouched for displayText to handle.
    expect(rest).toBe(`the answer${USAGE_SENTINEL}{"t":1}`);
    expect(displayText(rest)).toBe("the answer");
  });
});

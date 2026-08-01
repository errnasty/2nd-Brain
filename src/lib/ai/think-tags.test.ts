import { describe, expect, it } from "vitest";
import { createThinkStripper, stripThinkTags } from "./think-tags";

/** Feed `text` through the stripper in fixed-size chunks, like a real stream. */
function streamed(text: string, chunk: number): string {
  const s = createThinkStripper();
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += s.push(text.slice(i, i + chunk));
  return out + s.flush();
}

describe("stripThinkTags", () => {
  it("leaves ordinary text alone", () => {
    expect(stripThinkTags("The lead story is **X** [3].")).toBe("The lead story is **X** [3].");
  });

  it("removes a think block and keeps the answer", () => {
    expect(stripThinkTags("<think>let me weigh these</think>Real answer [1].")).toBe(
      "Real answer [1].",
    );
  });

  it("keeps text on both sides of a block", () => {
    expect(stripThinkTags("before <think>hidden</think> after")).toBe("before  after");
  });

  it("removes several blocks", () => {
    expect(stripThinkTags("a<think>x</think>b<think>y</think>c")).toBe("abc");
  });

  it("handles the <thinking> spelling too", () => {
    expect(stripThinkTags("<thinking>hmm</thinking>done")).toBe("done");
  });

  // The failure that made a section render as raw reasoning: the output cap
  // landed mid-thought, so the closing tag never arrived and the answer never
  // started. There is nothing to show — showing the thinking is worse.
  it("drops an unterminated think block entirely", () => {
    expect(stripThinkTags("<think>I should start by considering")).toBe("");
  });

  it("does not treat other markup as a think tag", () => {
    expect(stripThinkTags("a <thought> b </thought> c")).toBe("a <thought> b </thought> c");
  });
});

describe("createThinkStripper (streaming)", () => {
  // A tag split across chunk boundaries must never flash as raw text — which is
  // the whole reason this is a stateful filter rather than a regex at the end.
  it("matches the one-shot result at every chunk size", () => {
    const text = "intro <think>reasoning about [1] and [2]</think>The lead is X [1].";
    const expected = "intro The lead is X [1].";
    for (let chunk = 1; chunk <= 12; chunk += 1) {
      expect(streamed(text, chunk)).toBe(expected);
    }
  });

  it("holds back a partial opener until it is resolved", () => {
    const s = createThinkStripper();
    expect(s.push("answer <thi")).toBe("answer ");
    // Not a think tag after all — the held-back text has to come back out.
    expect(s.push("s is fine")).toBe("<this is fine");
    expect(s.flush()).toBe("");
  });

  it("emits nothing while inside a block, then resumes", () => {
    const s = createThinkStripper();
    expect(s.push("<think>step one")).toBe("");
    expect(s.push(" step two")).toBe("");
    expect(s.push("</think>Answer.")).toBe("Answer.");
    expect(s.flush()).toBe("");
  });
});

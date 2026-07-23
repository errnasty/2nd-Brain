import { describe, expect, it } from "vitest";
import { looksSelfContained } from "./rewrite";

describe("looksSelfContained", () => {
  it("treats long, reference-free questions as self-contained (skip rewrite)", () => {
    expect(looksSelfContained("What did my saved economics articles say about inflation trends")).toBe(true);
  });

  it("flags follow-ups with referential terms for rewriting", () => {
    expect(looksSelfContained("what about the second one")).toBe(false);
    expect(looksSelfContained("can you explain it in more detail for me please")).toBe(false);
    expect(looksSelfContained("summarize those articles about the topic we discussed")).toBe(false);
  });

  it("flags short questions for rewriting (may rely on context)", () => {
    expect(looksSelfContained("tell me more")).toBe(false);
    expect(looksSelfContained("why")).toBe(false);
  });
});

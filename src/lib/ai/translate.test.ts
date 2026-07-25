import { describe, expect, it } from "vitest";
import { chunkHtml } from "./translate";

describe("chunkHtml", () => {
  it("leaves short HTML as a single chunk", () => {
    const html = "<p>Hello</p><p>World</p>";
    expect(chunkHtml(html)).toEqual([html]);
  });

  it("splits long HTML at top-level block boundaries", () => {
    const para = `<p>${"word ".repeat(40)}</p>`; // ~207 chars
    const html = para.repeat(10);
    const chunks = chunkHtml(html, 500);
    expect(chunks.length).toBeGreaterThan(1);
    // Never split mid-tag: every chunk is balanced at the boundaries.
    for (const c of chunks) {
      expect(c.startsWith("<p>")).toBe(true);
      expect(c.endsWith("</p>")).toBe(true);
    }
  });

  it("reassembles to exactly the original input", () => {
    const html = ["<h2>Title</h2>", ...Array.from({ length: 12 }, (_, i) => `<p>Paragraph number ${i} with some text.</p>`)].join("");
    expect(chunkHtml(html, 200).join("")).toBe(html);
  });

  it("respects the size limit for normal blocks", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<p>Block ${i}</p>`).join("");
    for (const c of chunkHtml(html, 100)) expect(c.length).toBeLessThanOrEqual(100);
  });

  it("hard-splits a single oversized block instead of looping forever", () => {
    const html = `<p>${"x".repeat(5000)}</p>`;
    const chunks = chunkHtml(html, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(html);
  });

  it("drops empty/whitespace-only chunks", () => {
    expect(chunkHtml("   ", 100)).toEqual([]);
  });

  it("handles mixed block types", () => {
    const html = "<h1>H</h1><p>One</p><blockquote>Q</blockquote><ul><li>a</li></ul><p>Two</p>";
    expect(chunkHtml(html, 30).join("")).toBe(html);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeModelHtml, sanitizeRewrittenTitle, stripFence } from "./rewrite-output";

describe("stripFence", () => {
  it("unwraps an html fence", () => {
    expect(stripFence("```html\n<p>Hi</p>\n```")).toBe("<p>Hi</p>");
  });

  it("unwraps a bare fence", () => {
    expect(stripFence("```\n<p>Hi</p>\n```")).toBe("<p>Hi</p>");
  });

  it("leaves unfenced content alone", () => {
    expect(stripFence("<p>Hi</p>")).toBe("<p>Hi</p>");
  });
});

describe("normalizeModelHtml", () => {
  it("converts leaked ** bold ** to <strong>", () => {
    expect(normalizeModelHtml("<p>Tabular LLMs are **transformer models** here</p>")).toBe(
      "<p>Tabular LLMs are <strong>transformer models</strong> here</p>",
    );
  });

  it("handles several bold runs in one paragraph", () => {
    const out = normalizeModelHtml("<p>a **one** b **two** c</p>");
    expect(out).toBe("<p>a <strong>one</strong> b <strong>two</strong> c</p>");
  });

  it("converts bold spanning a hyphenated phrase", () => {
    expect(normalizeModelHtml("<p>in a **zero-shot** way</p>")).toBe(
      "<p>in a <strong>zero-shot</strong> way</p>",
    );
  });

  it("converts single-asterisk emphasis", () => {
    expect(normalizeModelHtml("<p>this is *important* here</p>")).toBe(
      "<p>this is <em>important</em> here</p>",
    );
  });

  it("does not degrade ** into nested single-asterisk emphasis", () => {
    expect(normalizeModelHtml("<p>**bold**</p>")).not.toContain("<em>");
  });

  it("converts backtick code", () => {
    expect(normalizeModelHtml("<p>call `fit()` first</p>")).toBe(
      "<p>call <code>fit()</code> first</p>",
    );
  });

  it("never rewrites inside a tag, so underscores in URLs survive", () => {
    const html = '<p>See <a href="https://x.com/a_b_c_d">the docs</a></p>';
    expect(normalizeModelHtml(html)).toBe(html);
  });

  it("leaves snake_case identifiers in prose alone", () => {
    const html = "<p>the read_status column</p>";
    expect(normalizeModelHtml(html)).toBe(html);
  });

  it("leaves a multiplication-style asterisk alone", () => {
    const html = "<p>3 * 4 * 5</p>";
    expect(normalizeModelHtml(html)).toBe(html);
  });

  it("wraps tagless Markdown output into paragraphs", () => {
    const out = normalizeModelHtml("First para.\n\nSecond **para**.");
    expect(out).toBe("<p>First para.</p><p>Second <strong>para</strong>.</p>");
  });

  it("does not re-wrap output that already has block structure", () => {
    const out = normalizeModelHtml("<h2>T</h2>\n\n<p>Body</p>");
    expect(out).toContain("<h2>T</h2>");
    expect(out).not.toContain("<p><h2>");
  });

  it("strips a fence before converting", () => {
    expect(normalizeModelHtml("```html\n<p>a **b**</p>\n```")).toBe(
      "<p>a <strong>b</strong></p>",
    );
  });

  it("returns empty for empty input", () => {
    expect(normalizeModelHtml("   ")).toBe("");
  });
});

describe("sanitizeRewrittenTitle", () => {
  const original = "The Fluid Simulator That Doesn't Solve the Fluid Equations";

  it("accepts a plausible rewrite", () => {
    expect(sanitizeRewrittenTitle("A Fluid Simulator That Skips the Equations", original)).toBe(
      "A Fluid Simulator That Skips the Equations",
    );
  });

  it("rejects a paragraph of prose answered instead of a headline", () => {
    const prose =
      "Tabular LLMs are **transformer models for spreadsheet-like data** that can make predictions on tables, often in a **zero-shot** or **few-shot** way without retraining on your specific dataset.";
    expect(sanitizeRewrittenTitle(prose, "Tabular LLMs")).toBeNull();
  });

  it("rejects output carrying bracketed source markers", () => {
    expect(sanitizeRewrittenTitle("Tabular models explained[2][6]", original)).toBeNull();
  });

  it("rejects a multi-line answer", () => {
    expect(sanitizeRewrittenTitle("A headline\n\nAnd an explanation", original)).toBeNull();
  });

  it("rejects anything past the absolute length cap", () => {
    expect(sanitizeRewrittenTitle("x".repeat(200), "y".repeat(180))).toBeNull();
  });

  it("strips Markdown emphasis rather than rendering it", () => {
    expect(sanitizeRewrittenTitle("**A Simpler Headline**", original)).toBe("A Simpler Headline");
  });

  it("strips stray HTML", () => {
    expect(sanitizeRewrittenTitle("<h1>A Simpler Headline</h1>", original)).toBe(
      "A Simpler Headline",
    );
  });

  it("drops a conversational preamble", () => {
    expect(sanitizeRewrittenTitle("Here's a simpler version: A Plain Headline", original)).toBe(
      "A Plain Headline",
    );
  });

  it("drops surrounding quotes", () => {
    expect(sanitizeRewrittenTitle('"A Plain Headline"', original)).toBe("A Plain Headline");
  });

  it("returns null for empty output", () => {
    expect(sanitizeRewrittenTitle("   ", original)).toBeNull();
  });

  it("allows a modest lengthening, since plainer wording runs longer", () => {
    const short = "LBM Explained";
    expect(sanitizeRewrittenTitle("The Lattice Boltzmann Method, Explained Simply", short)).toBe(
      "The Lattice Boltzmann Method, Explained Simply",
    );
  });
});

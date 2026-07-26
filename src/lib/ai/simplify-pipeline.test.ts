import { describe, expect, it } from "vitest";
import { normalizeModelHtml, sanitizeRewrittenTitle } from "./rewrite-output";
import { cleanHtml } from "@/lib/sanitize";

/**
 * Regression tests pinned to a real reported failure: a simplified article
 * arrived with literal `**` around phrases and with a paragraph of prose
 * rendered in the headline. These run the two guards in the same order the
 * route does (normalize, then sanitize), against the exact text that shipped.
 */
describe("simplify output pipeline, as the reader receives it", () => {
  it("renders leaked Markdown emphasis as real bold", () => {
    const fromModel =
      "<p>Tabular LLMs are **transformer models for spreadsheet-like data** that can make predictions on tables, often in a **zero-shot** or **few-shot** way.</p>";
    const out = cleanHtml(normalizeModelHtml(fromModel));
    expect(out).not.toContain("**");
    expect(out).toContain("<strong>transformer models for spreadsheet-like data</strong>");
    expect(out).toContain("<strong>zero-shot</strong>");
    expect(out).toContain("<strong>few-shot</strong>");
  });

  it("discards a headline slot filled with explanatory prose", () => {
    const fromModel =
      "Tabular LLMs are **transformer models for spreadsheet-like data** that can make predictions on tables, often in a **zero-shot** or **few-shot** way without retraining on your specific dataset.[2][6] In the article's framing, a **tabular foundation model** is a single pretrained model.";
    expect(sanitizeRewrittenTitle(fromModel, "Tabular Foundation Models")).toBeNull();
  });

  it("keeps sanitisation intact after normalisation", () => {
    const fromModel = '<p onclick="steal()">a **b** <script>bad()</script></p>';
    const out = cleanHtml(normalizeModelHtml(fromModel));
    expect(out).toContain("<strong>b</strong>");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("script");
  });
});

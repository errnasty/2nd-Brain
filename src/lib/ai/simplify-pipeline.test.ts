import { describe, expect, it } from "vitest";
import {
  looksLikeMetaCommentary,
  normalizeModelHtml,
  sanitizeRewrittenTitle,
  visibleText,
} from "./rewrite-output";
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

/**
 * Pinned to a second reported failure: a simplified article rendered as the
 * model's side of a conversation — "I'm ready to rewrite your HTML section,
 * but I don't see the content yet…" — because a chunk carried markup and no
 * prose, and nothing vetted the reply before it became the article body.
 */
describe("meta-commentary instead of a rewrite", () => {
  const REPORTED =
    "I'm ready to rewrite your HTML section, but I don't see the content yet. The message just " +
    "contains an opening `` tag. Please paste the full section you'd like me to rewrite, and I'll " +
    "simplify the language while preserving all the HTML structure and information.";

  it("catches the exact reply that shipped to the reader", () => {
    expect(looksLikeMetaCommentary(REPORTED)).toBe(true);
    // Still caught after the pipeline has wrapped it in markup, which is the
    // form the guard actually sees.
    expect(looksLikeMetaCommentary(normalizeModelHtml(REPORTED))).toBe(true);
  });

  it("catches the other shapes of the same non-answer", () => {
    for (const reply of [
      "<p>Please provide the content you would like me to simplify.</p>",
      "<p>I cannot rewrite this because no content was provided.</p>",
      "<p>The input appears to be empty.</p>",
      "<p>As an AI, I'm unable to process that request.</p>",
      "<p>Sure! I'll rewrite it once you share the section with me.</p>",
    ]) {
      expect(looksLikeMetaCommentary(reply), reply).toBe(true);
    }
  });

  // The guard runs over every simplified paragraph, so a false positive
  // silently discards a good rewrite. Real reporting must survive it —
  // including articles that quote people, discuss AI, or mention pasting.
  it("leaves genuine article prose alone", () => {
    for (const body of [
      "<p>The researchers said they could not see the content of the sealed report.</p>",
      "<p>“I'm ready to rewrite the rules,” the minister told reporters on Tuesday.</p>",
      "<p>As an AI company, Anthropic said the model was trained on public text.</p>",
      "<p>She said the message contains an apology, but the family wants more.</p>",
      "<p>Users paste the code into a terminal, which installs the package.</p>",
      "<p>The section is empty because the council removed it last year.</p>",
      "<p>\u201cI'm unable to comment on an ongoing case,\u201d the spokesman said.</p>",
      "<p>The court asked the ministry to provide the documents by Friday.</p>",
    ]) {
      expect(looksLikeMetaCommentary(body), body).toBe(false);
    }
  });
});

describe("visibleText", () => {
  it("returns only what a reader sees", () => {
    expect(visibleText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  // The chunk shape that caused the bug: markup, no prose. Callers use the
  // length of this to decide there is nothing worth rewriting.
  it("is empty for a markup-only chunk", () => {
    expect(visibleText('<figure><img src="x.png"></figure>')).toBe("");
    expect(visibleText("<div><p></p></div>")).toBe("");
    expect(visibleText("&nbsp;&nbsp;")).toBe("");
  });

  it("does not leak script or style bodies into the text", () => {
    expect(visibleText("<style>p{color:red}</style><p>Real</p>")).toBe("Real");
    expect(visibleText("<script>steal()</script><p>Real</p>")).toBe("Real");
  });
});

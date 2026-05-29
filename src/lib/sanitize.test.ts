import { describe, expect, it } from "vitest";
import { cleanHtml } from "./sanitize";

describe("cleanHtml", () => {
  it("strips <script> tags", () => {
    const out = cleanHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const out = cleanHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("drops javascript: URLs", () => {
    const out = cleanHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("keeps safe reading markup", () => {
    const out = cleanHtml("<h2>Title</h2><p>body <strong>bold</strong></p><ul><li>a</li></ul>");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<li>a</li>");
  });

  it("forces safe rel/target on links", () => {
    const out = cleanHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("noopener");
  });

  it("handles null/empty", () => {
    expect(cleanHtml(null)).toBe("");
    expect(cleanHtml(undefined)).toBe("");
    expect(cleanHtml("")).toBe("");
  });
});

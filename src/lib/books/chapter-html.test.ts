import { describe, expect, it } from "vitest";
import { chapterText, firstHeading, prepareChapterHtml } from "./chapter-html";

const OPTS = {
  chapterPath: "OEBPS/text/ch1.xhtml",
  spineIdxByPath: new Map([
    ["OEBPS/text/ch1.xhtml", 0],
    ["OEBPS/text/ch2.xhtml", 1],
  ]),
  assetUrl: (zipPath: string) => `/api/book/BOOK/asset/${zipPath}`,
};

const run = (html: string) => prepareChapterHtml(html, OPTS);

describe("prepareChapterHtml — safety", () => {
  it("strips scripts and event handlers", () => {
    const out = run(`<p onclick="steal()">hi</p><script>steal()</script>`);
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });

  it("drops javascript: links", () => {
    expect(run(`<a href="javascript:alert(1)">x</a>`)).not.toContain("javascript:");
  });

  it("does not leak the head title into the body text", () => {
    const out = run(`<html><head><title>Cover</title></head><body><p>Real text</p></body></html>`);
    expect(out).toContain("Real text");
    expect(out).not.toContain("Cover");
  });
});

describe("prepareChapterHtml — images", () => {
  it("rewrites a relative src to the asset API", () => {
    expect(run(`<img src="../images/a.png" alt="A"/>`)).toContain(
      `src="/api/book/BOOK/asset/OEBPS/images/a.png"`,
    );
  });

  it("drops an image that points outside the book instead of leaving it broken", () => {
    expect(run(`<img src="../../../../etc/passwd" alt="x"/>`)).not.toContain("<img");
    expect(run(`<img src="https://tracker.example.com/p.gif"/>`)).not.toContain("<img");
  });

  it("flattens the SVG-wrapped cover idiom into a plain image", () => {
    const svg = `<svg viewBox="0 0 600 800"><image xlink:href="../images/cover.jpg"/></svg>`;
    const out = run(svg);
    expect(out).toContain(`src="/api/book/BOOK/asset/OEBPS/images/cover.jpg"`);
    expect(out).not.toContain("<svg");
  });

  it("lazy-loads, so a chapter of plates does not fetch them all at once", () => {
    expect(run(`<img src="a.png"/>`)).toContain(`loading="lazy"`);
  });
});

describe("prepareChapterHtml — links", () => {
  it("turns a link to another chapter into reader navigation", () => {
    const out = run(`<a href="ch2.xhtml">Next</a>`);
    expect(out).toContain(`data-book-chapter="1"`);
    expect(out).toContain("Next");
  });

  it("carries the fragment through", () => {
    expect(run(`<a href="ch2.xhtml#note-3">n</a>`)).toContain(`data-book-fragment="note-3"`);
  });

  it("leaves a same-chapter fragment as a plain anchor", () => {
    const out = run(`<a href="#note-3">3</a>`);
    expect(out).toContain(`href="#note-3"`);
    expect(out).not.toContain("data-book-chapter");
  });

  it("keeps the words but drops the link when it points at a non-chapter file", () => {
    const out = run(`<a href="../styles/main.css">Style</a>`);
    expect(out).toContain("Style");
    expect(out).not.toContain("href");
  });

  it("opens an external link safely in a new tab", () => {
    const out = run(`<a href="https://example.com">site</a>`);
    expect(out).toContain(`target="_blank"`);
    expect(out).toContain("noopener");
  });

  it("keeps ids, because a book links to its own footnotes", () => {
    expect(run(`<p id="note-3">note</p>`)).toContain(`id="note-3"`);
  });
});

describe("chapterText", () => {
  it("returns the words without the markup", () => {
    expect(chapterText(`<h1>Title</h1><p>One <em>two</em>.</p>`)).toBe("Title\nOne two.");
  });

  it("drops head, script and style content", () => {
    expect(chapterText(`<head><title>T</title></head><p>Body</p>`)).toBe("Body");
    expect(chapterText(`<style>p{color:red}</style><p>Body</p>`)).toBe("Body");
  });

  it("decodes the entities a reader would otherwise see raw", () => {
    expect(chapterText(`<p>Tom &amp; Jerry &#8212; &quot;hi&quot;</p>`)).toBe('Tom & Jerry — "hi"');
  });

  it("collapses runs of blank lines", () => {
    expect(chapterText(`<p>a</p><p></p><p></p><p></p><p>b</p>`)).toBe("a\n\nb");
  });
});

describe("firstHeading", () => {
  it("finds a heading at any level and strips its markup", () => {
    expect(firstHeading(`<h2>Chapter <em>One</em></h2>`)).toBe("Chapter One");
    expect(firstHeading(`<div><h3>Deep</h3></div>`)).toBe("Deep");
  });

  it("returns null when there is nothing to name the chapter with", () => {
    expect(firstHeading(`<p>no headings here</p>`)).toBeNull();
    expect(firstHeading(`<h1>   </h1>`)).toBeNull();
  });
});

describe("chapterText — regressions", () => {
  it("breaks a line at <br>, which is not a closing tag", () => {
    expect(chapterText(`<p>Roses are red<br/>Violets are blue</p>`)).toBe(
      "Roses are red\nViolets are blue",
    );
    expect(chapterText(`a<br>b`)).toBe("a\nb");
  });

  it("leaves an out-of-range numeric entity alone instead of throwing", () => {
    // String.fromCodePoint throws above 0x10FFFF, and one malformed entity must
    // not take down the ingest of an entire book.
    expect(() => chapterText(`<p>&#99999999;</p>`)).not.toThrow();
    expect(chapterText(`<p>&#99999999;</p>`)).toBe("&#99999999;");
    expect(chapterText(`<p>&#8212;</p>`)).toBe("—");
  });
});

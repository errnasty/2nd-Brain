import { describe, expect, it } from "vitest";
import { navTitlesByPath, parseNavDocument, parseNcx } from "./epub";

describe("parseNavDocument (EPUB 3)", () => {
  const nav = `
    <html><body>
      <nav epub:type="toc">
        <ol>
          <li><a href="ch1.xhtml">One</a></li>
          <li><a href="ch2.xhtml">Two</a>
            <ol>
              <li><a href="ch2.xhtml#s1">Two point one</a></li>
            </ol>
          </li>
        </ol>
      </nav>
      <nav epub:type="landmarks">
        <ol><li><a href="ch9.xhtml">Start of content</a></li></ol>
      </nav>
    </body></html>`;

  it("keeps the contents in the book's own order", () => {
    expect(parseNavDocument(nav, "OEBPS/nav.xhtml").map((e) => e.title)).toEqual([
      "One",
      "Two",
      "Two point one",
    ]);
  });

  it("resolves targets against the nav document's own folder", () => {
    const out = parseNavDocument(nav, "OEBPS/nav.xhtml");
    expect(out[0].zipPath).toBe("OEBPS/ch1.xhtml");
    expect(out[1].zipPath).toBe("OEBPS/ch2.xhtml");
  });

  it("keeps the fragment, so an entry can point inside a file", () => {
    const out = parseNavDocument(nav, "OEBPS/nav.xhtml");
    // The whole reason the nav is stored separately: several entries can share
    // one file and differ only by anchor.
    expect(out[2]).toMatchObject({ zipPath: "OEBPS/ch2.xhtml", fragment: "s1" });
    expect(out[0].fragment).toBeNull();
  });

  it("uses list nesting for the outline level", () => {
    const out = parseNavDocument(nav, "OEBPS/nav.xhtml");
    expect(out.map((e) => e.level)).toEqual([1, 1, 2]);
  });

  it("ignores the landmarks nav, which is not a table of contents", () => {
    expect(parseNavDocument(nav, "OEBPS/nav.xhtml").some((e) => e.title.includes("Start"))).toBe(
      false,
    );
  });

  it("strips inline markup and decodes entities in a title", () => {
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol><li><a href="a.xhtml">Tom <b>&amp;</b> Jerry</a></li></ol></nav>`,
      "nav.xhtml",
    );
    expect(out[0].title).toBe("Tom & Jerry");
  });

  it("keeps every entry when a file is listed more than once", () => {
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol>
         <li><a href="a.xhtml">Chapter</a></li>
         <li><a href="a.xhtml#b">Section</a></li>
       </ol></nav>`,
      "nav.xhtml",
    );
    expect(out.map((e) => e.title)).toEqual(["Chapter", "Section"]);
  });

  it("falls back to the whole document when no toc nav is marked", () => {
    const out = parseNavDocument(`<ol><li><a href="a.xhtml">Plain</a></li></ol>`, "nav.xhtml");
    expect(out[0].title).toBe("Plain");
  });

  it("skips an anchor with no title text", () => {
    expect(
      parseNavDocument(`<nav epub:type="toc"><ol><li><a href="a.xhtml"></a></li></ol></nav>`, "nav.xhtml"),
    ).toEqual([]);
  });
});

describe("parseNcx (EPUB 2)", () => {
  const ncx = `<?xml version="1.0"?>
    <ncx><navMap>
      <navPoint><navLabel><text>One</text></navLabel><content src="text/ch1.xhtml"/>
        <navPoint><navLabel><text>One A</text></navLabel><content src="text/ch1.xhtml#a"/></navPoint>
      </navPoint>
      <navPoint><navLabel><text>Two</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
    </navMap></ncx>`;

  it("keeps depth-first order, which is reading order", () => {
    expect(parseNcx(ncx, "OEBPS/toc.ncx").map((e) => e.title)).toEqual(["One", "One A", "Two"]);
  });

  it("resolves targets against the ncx's folder and keeps fragments", () => {
    const out = parseNcx(ncx, "OEBPS/toc.ncx");
    expect(out[0]).toMatchObject({ zipPath: "OEBPS/text/ch1.xhtml", fragment: null });
    expect(out[1]).toMatchObject({ zipPath: "OEBPS/text/ch1.xhtml", fragment: "a" });
  });

  it("takes the outline level from navPoint nesting", () => {
    expect(parseNcx(ncx, "OEBPS/toc.ncx").map((e) => e.level)).toEqual([1, 2, 1]);
  });

  it("handles a single navPoint, which the XML parser hands back unwrapped", () => {
    const one = `<ncx><navMap><navPoint><navLabel><text>Only</text></navLabel>
      <content src="a.xhtml"/></navPoint></navMap></ncx>`;
    expect(parseNcx(one, "toc.ncx")[0].title).toBe("Only");
  });

  it("keeps a numeric-looking title as text", () => {
    const numeric = `<ncx><navMap><navPoint><navLabel><text>1984</text></navLabel>
      <content src="a.xhtml"/></navPoint></navMap></ncx>`;
    expect(parseNcx(numeric, "toc.ncx")[0].title).toBe("1984");
  });

  it("returns nothing rather than throwing on malformed XML", () => {
    expect(parseNcx("<ncx><navMap>", "toc.ncx")).toEqual([]);
    expect(parseNcx("", "toc.ncx")).toEqual([]);
  });
});

describe("navTitlesByPath", () => {
  it("names a file after the first entry that points at it", () => {
    const titles = navTitlesByPath([
      { title: "Chapter Three", level: 1, zipPath: "a.xhtml", fragment: null },
      { title: "A section within it", level: 2, zipPath: "a.xhtml", fragment: "s2" },
    ]);
    expect(titles.get("a.xhtml")?.title).toBe("Chapter Three");
  });

  it("names a file the toc only ever reaches through a fragment", () => {
    // Single-file books split by anchors are common; without this the file
    // would have no name at all.
    const titles = navTitlesByPath([
      { title: "Chapter Three", level: 1, zipPath: "all.xhtml", fragment: "c3" },
    ]);
    expect(titles.get("all.xhtml")?.title).toBe("Chapter Three");
  });
});

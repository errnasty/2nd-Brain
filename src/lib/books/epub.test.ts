import { describe, expect, it } from "vitest";
import { parseNavDocument, parseNcx } from "./epub";

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

  it("reads titles resolved against the nav document's own folder", () => {
    const out = parseNavDocument(nav, "OEBPS/nav.xhtml");
    expect(out.get("OEBPS/ch1.xhtml")?.title).toBe("One");
    expect(out.get("OEBPS/ch2.xhtml")?.title).toBe("Two");
  });

  it("uses list nesting for the outline level", () => {
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol>
         <li><a href="a.xhtml">Top</a>
           <ol><li><a href="b.xhtml">Nested</a></li></ol>
         </li>
       </ol></nav>`,
      "nav.xhtml",
    );
    expect(out.get("a.xhtml")?.level).toBe(1);
    expect(out.get("b.xhtml")?.level).toBe(2);
  });

  it("names a chapter that the toc only ever reaches through a fragment", () => {
    // Single-file books split by anchors are common; without this they would
    // have no chapter name at all.
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol><li><a href="all.xhtml#c3">Chapter Three</a></li></ol></nav>`,
      "nav.xhtml",
    );
    expect(out.get("all.xhtml")?.title).toBe("Chapter Three");
  });

  it("ignores the landmarks nav, which is not a table of contents", () => {
    expect(parseNavDocument(nav, "OEBPS/nav.xhtml").has("OEBPS/ch9.xhtml")).toBe(false);
  });

  it("strips inline markup and decodes entities in a title", () => {
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol><li><a href="a.xhtml">Tom <b>&amp;</b> Jerry</a></li></ol></nav>`,
      "nav.xhtml",
    );
    expect(out.get("a.xhtml")?.title).toBe("Tom & Jerry");
  });

  it("keeps the first title when a chapter is linked twice", () => {
    const out = parseNavDocument(
      `<nav epub:type="toc"><ol>
         <li><a href="a.xhtml">Real name</a></li>
         <li><a href="a.xhtml">Duplicate</a></li>
       </ol></nav>`,
      "nav.xhtml",
    );
    expect(out.get("a.xhtml")?.title).toBe("Real name");
  });

  it("falls back to the whole document when no toc nav is marked", () => {
    const out = parseNavDocument(`<ol><li><a href="a.xhtml">Plain</a></li></ol>`, "nav.xhtml");
    expect(out.get("a.xhtml")?.title).toBe("Plain");
  });

  it("skips an anchor with no title text", () => {
    const out = parseNavDocument(`<nav epub:type="toc"><ol><li><a href="a.xhtml"></a></li></ol></nav>`, "nav.xhtml");
    expect(out.size).toBe(0);
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

  it("reads titles and resolves them against the ncx's folder", () => {
    const out = parseNcx(ncx, "OEBPS/toc.ncx");
    expect(out.get("OEBPS/text/ch1.xhtml")?.title).toBe("One");
    expect(out.get("OEBPS/text/ch2.xhtml")?.title).toBe("Two");
  });

  it("takes the outline level from navPoint nesting", () => {
    const nested = `<ncx><navMap>
      <navPoint><navLabel><text>Top</text></navLabel><content src="a.xhtml"/>
        <navPoint><navLabel><text>Nested</text></navLabel><content src="b.xhtml"/></navPoint>
      </navPoint>
    </navMap></ncx>`;
    const out = parseNcx(nested, "toc.ncx");
    expect(out.get("a.xhtml")?.level).toBe(1);
    expect(out.get("b.xhtml")?.level).toBe(2);
  });

  it("keeps the outer title when a sub-entry points back into the same file", () => {
    const out = parseNcx(ncx, "OEBPS/toc.ncx");
    expect(out.get("OEBPS/text/ch1.xhtml")?.title).toBe("One");
  });

  it("handles a single navPoint, which the XML parser hands back unwrapped", () => {
    const one = `<ncx><navMap><navPoint><navLabel><text>Only</text></navLabel>
      <content src="a.xhtml"/></navPoint></navMap></ncx>`;
    expect(parseNcx(one, "toc.ncx").get("a.xhtml")?.title).toBe("Only");
  });

  it("keeps a numeric-looking title as text", () => {
    const numeric = `<ncx><navMap><navPoint><navLabel><text>1984</text></navLabel>
      <content src="a.xhtml"/></navPoint></navMap></ncx>`;
    expect(parseNcx(numeric, "toc.ncx").get("a.xhtml")?.title).toBe("1984");
  });

  it("returns nothing rather than throwing on malformed XML", () => {
    expect(parseNcx("<ncx><navMap>", "toc.ncx").size).toBe(0);
    expect(parseNcx("", "toc.ncx").size).toBe(0);
  });
});

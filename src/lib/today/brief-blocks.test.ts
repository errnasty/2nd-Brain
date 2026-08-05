import { describe, expect, it } from "vitest";
import { assembleBrief, blockMarkdown, sectionsMatchContent } from "./brief-blocks";

/** Sections as they exist while the brief is being read. */
function sections() {
  return [
    { label: "The lead", text: "**Rates hold.** [3]\n\nThe Fed blinked." },
    { label: "Geopolitics", text: "- Talks resumed [7]" },
    { label: "Quick clear", text: "- Press release [9] — marketing" },
  ];
}

describe("blockMarkdown", () => {
  it("puts the heading above the prose", () => {
    expect(blockMarkdown({ label: "The lead", text: "Something happened." })).toBe(
      "### The lead\n\nSomething happened.",
    );
  });

  it("emits nothing for a section with no text", () => {
    expect(blockMarkdown({ label: "The lead", text: "   " })).toBe("");
  });

  it("leaves an already-assembled brief alone", () => {
    // A stored brief carries its own headings and has no label of its own.
    expect(blockMarkdown({ label: "", text: "### The lead\n\nBody" })).toBe("### The lead\n\nBody");
  });
});

describe("assembleBrief", () => {
  it("joins the sections into one document", () => {
    expect(assembleBrief(sections())).toBe(
      "### The lead\n\n**Rates hold.** [3]\n\nThe Fed blinked.\n\n" +
        "### Geopolitics\n\n- Talks resumed [7]\n\n" +
        "### Quick clear\n\n- Press release [9] — marketing",
    );
  });

  it("drops a section that produced nothing rather than leaving a bare heading", () => {
    const withEmpty = [...sections(), { label: "Outside your feeds", text: "" }];
    expect(assembleBrief(withEmpty)).toBe(assembleBrief(sections()));
  });
});

describe("sectionsMatchContent", () => {
  it("recognises the sections a document was assembled from", () => {
    // The round trip that restores a morning's reading progress on revisit: if
    // this ever returns false for a brief's own sections, the progress bar and
    // the XP row silently disappear when you come back to Today.
    expect(sectionsMatchContent(sections(), assembleBrief(sections()))).toBe(true);
  });

  it("rejects sections from a different brief", () => {
    // Another device regenerated since; its boundaries would put the read
    // marks on the wrong desks.
    const other = [{ label: "The lead", text: "Something else entirely." }];
    expect(sectionsMatchContent(other, assembleBrief(sections()))).toBe(false);
  });

  it("rejects a reordered set, which would misplace every mark", () => {
    const [lead, geo, skip] = sections();
    expect(sectionsMatchContent([geo, lead, skip], assembleBrief(sections()))).toBe(false);
  });

  it("rejects an edited section, however small the edit", () => {
    const edited = sections().map((s, i) => (i === 1 ? { ...s, text: `${s.text}.` } : s));
    expect(sectionsMatchContent(edited, assembleBrief(sections()))).toBe(false);
  });

  it("has nothing to match when there are no sections", () => {
    expect(sectionsMatchContent([], "")).toBe(false);
    expect(sectionsMatchContent([], assembleBrief(sections()))).toBe(false);
  });
});

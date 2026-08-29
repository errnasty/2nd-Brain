import { describe, expect, it } from "vitest";
import { extractHeadings, slugify, toggleTaskAtLine, wordStats } from "./markdown";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Second Brain Notes")).toBe("second-brain-notes");
  });

  it("drops punctuation but keeps unicode letters", () => {
    expect(slugify("Café — what's next?!")).toBe("café-whats-next");
  });

  it("falls back for a heading with no slug-able characters", () => {
    expect(slugify("???")).toBe("section");
  });
});

describe("extractHeadings", () => {
  it("returns headings in document order with levels and 1-indexed lines", () => {
    const md = ["# One", "", "text", "## Two", "### Three"].join("\n");
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "One", slug: "one", line: 1 },
      { level: 2, text: "Two", slug: "two", line: 4 },
      { level: 3, text: "Three", slug: "three", line: 5 },
    ]);
  });

  it("ignores # inside fenced code blocks", () => {
    const md = ["# Real", "```sh", "# not a heading", "```", "## Also real"].join("\n");
    expect(extractHeadings(md).map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("closes a fence only on a matching marker", () => {
    const md = ["```", "# hidden", "~~~", "# still hidden", "```", "# visible"].join("\n");
    expect(extractHeadings(md).map((h) => h.text)).toEqual(["visible"]);
  });

  it("makes duplicate titles unique", () => {
    const md = ["## Notes", "## Notes", "## Notes"].join("\n");
    expect(extractHeadings(md).map((h) => h.slug)).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("strips inline markdown and wikilinks from heading text", () => {
    const md = "## **Bold** and [[Target|alias]] and `code`";
    expect(extractHeadings(md)[0].text).toBe("Bold and alias and code");
  });

  it("strips trailing closing hashes", () => {
    expect(extractHeadings("## Closed ##")[0].text).toBe("Closed");
  });

  it("ignores a hash with no space and empty input", () => {
    expect(extractHeadings("#nope")).toEqual([]);
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("toggleTaskAtLine", () => {
  it("checks an unchecked task", () => {
    expect(toggleTaskAtLine("- [ ] buy milk", 1)).toBe("- [x] buy milk");
  });

  it("unchecks a checked task, upper or lower case", () => {
    expect(toggleTaskAtLine("- [x] done", 1)).toBe("- [ ] done");
    expect(toggleTaskAtLine("- [X] done", 1)).toBe("- [ ] done");
  });

  it("preserves indentation on nested tasks and leaves siblings alone", () => {
    const md = ["- [ ] parent", "    - [ ] child"].join("\n");
    expect(toggleTaskAtLine(md, 2)).toBe(["- [ ] parent", "    - [x] child"].join("\n"));
  });

  it("handles ordered-list tasks and * / + bullets", () => {
    expect(toggleTaskAtLine("1. [ ] one", 1)).toBe("1. [x] one");
    expect(toggleTaskAtLine("* [ ] star", 1)).toBe("* [x] star");
    expect(toggleTaskAtLine("+ [ ] plus", 1)).toBe("+ [x] plus");
  });

  it("returns null for a non-task line or an out-of-range line", () => {
    expect(toggleTaskAtLine("just text", 1)).toBeNull();
    expect(toggleTaskAtLine("- [ ] a", 0)).toBeNull();
    expect(toggleTaskAtLine("- [ ] a", 2)).toBeNull();
  });

  it("does not disturb other lines", () => {
    const md = ["intro", "- [ ] a", "- [ ] b", "outro"].join("\n");
    expect(toggleTaskAtLine(md, 3)).toBe(["intro", "- [ ] a", "- [x] b", "outro"].join("\n"));
  });
});

describe("wordStats", () => {
  it("counts prose words", () => {
    expect(wordStats("one two three four five").words).toBe(5);
  });

  it("excludes fenced code from the count", () => {
    const md = ["one two", "```js", "const a = 1; const b = 2; const c = 3;", "```", "three"].join("\n");
    expect(wordStats(md).words).toBe(3);
  });

  it("counts link and wikilink labels, not their targets", () => {
    expect(wordStats("see [the docs](https://example.com/very/long/path)").words).toBe(3);
    expect(wordStats("see [[Some Note|the note]]").words).toBe(3);
  });

  it("reports zero minutes for an empty note and at least one otherwise", () => {
    expect(wordStats("")).toEqual({ words: 0, minutes: 0 });
    expect(wordStats("hello").minutes).toBe(1);
  });

  it("rounds reading time at ~220 wpm", () => {
    expect(wordStats("word ".repeat(660)).minutes).toBe(3);
  });
});

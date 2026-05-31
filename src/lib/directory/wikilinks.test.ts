import { describe, expect, it } from "vitest";
import { parseWikilinkTitles } from "./wikilinks-parse";

describe("parseWikilinkTitles", () => {
  it("extracts simple [[Title]]", () => {
    expect(parseWikilinkTitles("see [[Note A]] and [[Note B]]")).toEqual(["Note A", "Note B"]);
  });
  it("uses the title, not the alias, for [[Title|alias]]", () => {
    expect(parseWikilinkTitles("[[Real Title|shown text]]")).toEqual(["Real Title"]);
  });
  it("dedupes identical titles and trims whitespace", () => {
    // Dedupe is exact-string (case-insensitive resolution happens later at
    // lookup time), so "X" and "x" stay distinct here.
    expect(parseWikilinkTitles("[[ X ]] [[X]] [[Y]]")).toEqual(["X", "Y"]);
  });
  it("ignores non-links and empties", () => {
    expect(parseWikilinkTitles("no links here")).toEqual([]);
    expect(parseWikilinkTitles("[[]] [[ ]]")).toEqual([]);
    expect(parseWikilinkTitles(null)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { extractPhrases, matchTerms, normalizeTerm, rankTerms } from "./terms";

describe("normalizeTerm", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTerm("U.S.-China Trade War!")).toBe("u s china trade war");
  });
});

describe("extractPhrases", () => {
  it("emits words and adjacent bigrams, minus stop words", () => {
    const phrases = extractPhrases("The Fed holds interest rates steady");
    expect(phrases).toContain("interest");
    expect(phrases).toContain("interest rates");
    expect(phrases).not.toContain("the");
  });

  it("drops bare numbers and very short tokens", () => {
    const phrases = extractPhrases("Stocks up 42 in Q3");
    expect(phrases).not.toContain("42");
    expect(phrases.every((p) => !/^\d+$/.test(p))).toBe(true);
  });
});

describe("rankTerms", () => {
  const headlines = [
    { title: "Fed holds interest rates steady", weight: 1 },
    { title: "Interest rates unchanged as Fed meets", weight: 0.9 },
    { title: "Fed decision leaves interest rates flat", weight: 0.8 },
    { title: "Local bakery wins county prize", weight: 0.1 },
  ];

  it("ranks the recurring story above the one-off", () => {
    const terms = rankTerms(headlines, { limit: 20 });
    const byTerm = new Map(terms.map((t) => [t.term, t.weight]));
    expect(byTerm.get("interest rates") ?? 0).toBeGreaterThan(byTerm.get("bakery") ?? 0);
  });

  it("normalizes weights into 0–1 with a top term at 1", () => {
    const terms = rankTerms(headlines);
    expect(terms[0].weight).toBeCloseTo(1, 6);
    expect(terms.every((t) => t.weight >= 0 && t.weight <= 1)).toBe(true);
  });

  it("can require a term to appear more than once", () => {
    const terms = rankTerms(headlines, { minCount: 2 });
    expect(terms.some((t) => t.term === "bakery")).toBe(false);
    expect(terms.some((t) => t.term.includes("interest"))).toBe(true);
  });

  it("returns nothing for empty input", () => {
    expect(rankTerms([])).toEqual([]);
  });

  it("is deterministic across identical input", () => {
    expect(rankTerms(headlines)).toEqual(rankTerms(headlines));
  });
});

describe("matchTerms", () => {
  const terms = [
    { term: "interest rates", weight: 1 },
    { term: "rates", weight: 0.8 },
    { term: "volcano", weight: 0.5 },
  ];

  it("matches on whole words only", () => {
    const hits = matchTerms({ title: "Corporates brace for impact" }, terms);
    expect(hits).toEqual([]);
  });

  it("matches phrases and single words in the title", () => {
    const hits = matchTerms({ title: "Fed leaves interest rates alone" }, terms).map((t) => t.term);
    expect(hits).toContain("interest rates");
    expect(hits).toContain("rates");
    expect(hits).not.toContain("volcano");
  });

  // A trending boost earned by a passing mention deep in the body is exactly
  // the false positive that makes a ranked feed feel arbitrary.
  it("ignores mentions past the excerpt lead", () => {
    const buried = `${"padding words ".repeat(40)} volcano`;
    expect(matchTerms({ title: "A quiet day", excerpt: buried }, terms)).toEqual([]);
  });

  it("handles a missing excerpt", () => {
    expect(matchTerms({ title: "Volcano erupts", excerpt: null }, terms).map((t) => t.term)).toEqual(
      ["volcano"],
    );
  });
});

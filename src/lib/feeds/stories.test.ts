import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  groupStories,
  normalizeTitle,
  storyKey,
  storyReadTargets,
  titlesMatch,
} from "./stories";

type Row = { id: string; title: string; clusterId?: string | null; url?: string | null };

/** A list as the trending sort delivers it: tellings of a story adjacent. */
function list(): Row[] {
  return [
    { id: "a1", title: "Fed holds rates steady", clusterId: "c1" },
    { id: "a2", title: "Fed leaves rates unchanged", clusterId: "c1" },
    { id: "a3", title: "Rate decision: no change", clusterId: "c1" },
    { id: "b1", title: "OpenAI ships open weights", clusterId: "c2" },
    { id: "z1", title: "A recipe for sourdough" },
    { id: "z2", title: "A Recipe for Sourdough!" },
  ];
}

describe("storyKey", () => {
  it("prefers the cluster the trending pass computed", () => {
    expect(storyKey({ id: "a", title: "Anything", clusterId: "c1" })).toBe("c:c1");
  });

  it("falls back to the normalized title when there is no cluster", () => {
    expect(storyKey({ id: "a", title: "A Recipe for Sourdough!" })).toBe(
      `t:${normalizeTitle("a recipe for sourdough")}`,
    );
  });

  it("cannot confuse a title with a cluster id", () => {
    const clustered = storyKey({ id: "a", title: "x", clusterId: "c1" });
    const titled = storyKey({ id: "b", title: "c1" });
    expect(clustered).not.toBe(titled);
  });
});

describe("groupStories", () => {
  it("returns the list untouched when collapsing is off", () => {
    const items = list();
    const g = groupStories(items, { collapse: false });
    expect(g.visible).toBe(items);
    expect(g.tellings.size).toBe(0);
  });

  it("keeps one row per story and hangs the rest off its lead", () => {
    const g = groupStories(list(), { collapse: true });
    expect(g.visible.map((i) => i.id)).toEqual(["a1", "b1", "z1"]);
    expect(g.tellings.get("a1")?.map((i) => i.id)).toEqual(["a2", "a3"]);
    expect(g.tellings.get("b1")).toEqual([]);
  });

  it("catches near-duplicates the old title match missed", () => {
    // The three Fed headlines share no normalized title — only the cluster.
    const g = groupStories(list(), { collapse: true });
    expect(g.tellings.get("a1")).toHaveLength(2);
  });

  it("still collapses exact title repeats with no cluster", () => {
    const g = groupStories(list(), { collapse: true });
    expect(g.tellings.get("z1")?.map((i) => i.id)).toEqual(["z2"]);
  });

  it("shows an expanded story's tellings in place, after its lead", () => {
    const g = groupStories(list(), { collapse: true, expanded: new Set(["a1"]) });
    expect(g.visible.map((i) => i.id)).toEqual(["a1", "a2", "a3", "b1", "z1"]);
  });

  it("never reorders the list it was given", () => {
    const g = groupStories(list(), { collapse: true, expanded: new Set(["a1", "z1"]) });
    const input = list().map((i) => i.id);
    const positions = g.visible.map((i) => input.indexOf(i.id));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("canonicalUrl", () => {
  it("ignores tracking parameters, www and trailing slashes", () => {
    const a = canonicalUrl("https://www.example.com/news/story/?utm_source=rss&utm_medium=feed");
    const b = canonicalUrl("https://example.com/news/story");
    expect(a).toBe(b);
  });

  it("treats an AMP copy as the page it mirrors", () => {
    expect(canonicalUrl("https://example.com/news/story/amp")).toBe(
      canonicalUrl("https://example.com/news/story"),
    );
  });

  it("keeps parameters that identify the document", () => {
    expect(canonicalUrl("https://example.com/read?id=99")).not.toBe(
      canonicalUrl("https://example.com/read?id=100"),
    );
  });

  it("orders parameters so listing them differently still matches", () => {
    expect(canonicalUrl("https://example.com/a?x=1&y=2")).toBe(
      canonicalUrl("https://example.com/a?y=2&x=1"),
    );
  });

  // Grouping every unparseable link together would hide unrelated articles.
  it("refuses to key on anything it cannot parse", () => {
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl("")).toBeNull();
    expect(canonicalUrl(null)).toBeNull();
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("strips the outlet suffix feeds append", () => {
    expect(normalizeTitle("Fed holds rates steady - Reuters")).toBe(
      normalizeTitle("Fed holds rates steady | CNBC"),
    );
  });

  // Headlines legitimately contain dashes; eating the informative half of one
  // would merge stories that share only an opening clause.
  it("leaves a long tail after a dash alone", () => {
    expect(normalizeTitle("Summit collapses — what happens to the talks now")).toContain(
      "what happens",
    );
  });
});

describe("titlesMatch", () => {
  it("merges a headline with a trailing clause bolted on", () => {
    expect(
      titlesMatch("Fed holds rates steady", "Fed holds rates steady as inflation cools"),
    ).toBe(true);
  });

  it("does not merge two stories that share a couple of words", () => {
    expect(titlesMatch("Apple announces new iPhone", "Apple loses appeal in patent case")).toBe(
      false,
    );
  });

  it("needs more than a two-word overlap to claim containment", () => {
    expect(titlesMatch("Apple earnings", "Apple earnings beat expectations as services grow")).toBe(
      false,
    );
  });
});

describe("groupStories — matching beyond the cluster id", () => {
  it("collapses the same link carried by two feeds under different titles", () => {
    const g = groupStories(
      [
        { id: "u1", title: "Fed holds rates steady", url: "https://example.com/fed?utm_source=a" },
        { id: "u2", title: "Fed keeps rates on hold", url: "https://www.example.com/fed/" },
      ],
      { collapse: true },
    );
    expect(g.visible.map((i) => i.id)).toEqual(["u1"]);
    expect(g.tellings.get("u1")?.map((i) => i.id)).toEqual(["u2"]);
  });

  it("collapses the same headline wearing two different outlet suffixes", () => {
    const g = groupStories(
      [
        { id: "s1", title: "Quake hits southern Japan - Reuters" },
        { id: "s2", title: "Quake hits southern Japan | NHK" },
      ],
      { collapse: true },
    );
    expect(g.tellings.get("s1")?.map((i) => i.id)).toEqual(["s2"]);
  });

  // The trending pass compared embeddings; a lexical guess must not overrule it.
  it("never merges rows the trending pass put in different clusters", () => {
    const g = groupStories(
      [
        { id: "c1a", title: "Fed holds rates steady", clusterId: "c1" },
        { id: "c2a", title: "Fed holds rates steady", clusterId: "c2" },
      ],
      { collapse: true },
    );
    expect(g.visible.map((i) => i.id)).toEqual(["c1a", "c2a"]);
  });

  it("lets an unscored row join the story a scored row already leads", () => {
    const g = groupStories(
      [
        { id: "lead", title: "Quake hits southern Japan", clusterId: "c9" },
        { id: "fresh", title: "Quake hits southern Japan | NHK" },
      ],
      { collapse: true },
    );
    expect(g.tellings.get("lead")?.map((i) => i.id)).toEqual(["fresh"]);
  });

  it("keeps unrelated rows apart", () => {
    const g = groupStories(
      [
        { id: "x", title: "Apple announces new iPhone" },
        { id: "y", title: "Fed holds rates steady" },
        { id: "z", title: "A recipe for sourdough" },
      ],
      { collapse: true },
    );
    expect(g.visible).toHaveLength(3);
  });
});

describe("storyReadTargets", () => {
  it("takes the collapsed tellings with it", () => {
    const g = groupStories(list(), { collapse: true });
    expect(storyReadTargets("a1", g, new Set())).toEqual(["a1", "a2", "a3"]);
  });

  it("leaves expanded tellings alone — they are rows in their own right", () => {
    const expanded = new Set(["a1"]);
    const g = groupStories(list(), { collapse: true, expanded });
    expect(storyReadTargets("a1", g, expanded)).toEqual(["a1"]);
  });

  it("is just the row itself for a story of one", () => {
    const g = groupStories(list(), { collapse: true });
    expect(storyReadTargets("b1", g, new Set())).toEqual(["b1"]);
    expect(storyReadTargets("unknown", g, new Set())).toEqual(["unknown"]);
  });
});

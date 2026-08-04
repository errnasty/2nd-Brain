import { describe, expect, it } from "vitest";
import { groupStories, normalizeTitle, storyKey, storyReadTargets } from "./stories";

type Row = { id: string; title: string; clusterId?: string | null };

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

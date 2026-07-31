import { describe, expect, it } from "vitest";
import {
  CLUSTER_WINDOW_HOURS,
  clusterArticles,
  cosine,
  jaccard,
  representativeTitle,
  titleShingles,
  titleWords,
  type ClusterableArticle,
} from "./cluster";

const T0 = new Date("2026-07-31T09:00:00Z");
const at = (hoursAfter: number) => new Date(T0.getTime() + hoursAfter * 3600_000);

function article(
  id: string,
  title: string,
  feedId: string,
  opts: { at?: number; embedding?: number[] } = {},
): ClusterableArticle {
  return {
    id,
    title,
    feedId,
    publishDate: at(opts.at ?? 0),
    embedding: opts.embedding ?? null,
  };
}

/** A unit vector pointing mostly along `axis` — a stand-in for a topic. */
function vec(axis: number, jitter = 0): number[] {
  const v = [0, 0, 0, 0];
  v[axis] = 1;
  v[(axis + 1) % 4] = jitter;
  return v;
}

describe("titleWords / titleShingles", () => {
  it("drops stop words and punctuation", () => {
    expect(titleWords("The Fed, at last, holds rates")).toEqual(["fed", "last", "holds", "rates"]);
  });

  it("falls back to single words for titles shorter than one shingle", () => {
    expect(titleShingles("Fed holds")).toEqual(new Set(["fed", "holds"]));
  });
});

describe("jaccard", () => {
  it("is 0 for empty sets and 1 for identical ones", () => {
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
});

describe("cosine", () => {
  it("scores parallel vectors 1 and orthogonal ones 0", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  // A stale embedding from before a model change must degrade clustering,
  // never throw inside the cron.
  it("returns 0 on dimension mismatch or empty input", () => {
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});

describe("clusterArticles", () => {
  it("returns nothing for an empty window", () => {
    expect(clusterArticles([])).toEqual([]);
  });

  it("merges syndicated copy on headline overlap alone, with no embeddings", () => {
    const items = [
      article("a", "Fed holds interest rates steady in July", "reuters"),
      article("b", "Fed holds interest rates steady in July meeting", "ft", { at: 1 }),
      article("c", "Fed holds interest rates steady, citing inflation", "bbc", { at: 2 }),
    ];
    const clusters = clusterArticles(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].distinctFeeds).toBe(3);
    expect(clusters[0].articleIds.sort()).toEqual(["a", "b", "c"]);
  });

  // The case title overlap can never catch — different words, same story.
  it("merges differently-worded tellings via embeddings", () => {
    const items = [
      article("a", "Fed holds interest rates steady", "reuters", { embedding: vec(0) }),
      article("b", "No change from the FOMC this month", "ft", { at: 1, embedding: vec(0, 0.05) }),
    ];
    const clusters = clusterArticles(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].distinctFeeds).toBe(2);
  });

  it("keeps unrelated stories apart", () => {
    const items = [
      article("a", "Fed holds interest rates steady", "reuters", { embedding: vec(0) }),
      article("b", "Volcano erupts in southern Iceland", "bbc", { embedding: vec(1) }),
    ];
    expect(clusterArticles(items)).toHaveLength(2);
  });

  // One outlet posting five follow-ups is not five independent sources — this
  // is the property the whole corroboration model rests on.
  it("counts distinct feeds, not articles", () => {
    const items = [
      article("a", "Fed holds interest rates steady in July", "reuters"),
      article("b", "Fed holds interest rates steady in July again", "reuters", { at: 1 }),
      article("c", "Fed holds interest rates steady in July still", "reuters", { at: 2 }),
    ];
    const [cluster] = clusterArticles(items);
    expect(cluster.articleIds).toHaveLength(3);
    expect(cluster.distinctFeeds).toBe(1);
  });

  it("refuses to merge the same subject across a long time gap", () => {
    const items = [
      article("a", "Fed holds interest rates steady in July", "reuters", { at: 0 }),
      article("b", "Fed holds interest rates steady in July", "ft", {
        at: CLUSTER_WINDOW_HOURS + 5,
      }),
    ];
    expect(clusterArticles(items)).toHaveLength(2);
  });

  it("tracks first and last sighting across members", () => {
    const items = [
      article("a", "Fed holds interest rates steady in July", "reuters", { at: 0 }),
      article("b", "Fed holds interest rates steady in July meeting", "ft", { at: 5 }),
    ];
    const [cluster] = clusterArticles(items);
    expect(cluster.firstSeen.toISOString()).toBe(at(0).toISOString());
    expect(cluster.lastSeen.toISOString()).toBe(at(5).toISOString());
  });

  // Transitivity through union-find: a~b and b~c must put all three together
  // even when a and c never match each other directly.
  it("chains transitive matches into one cluster", () => {
    const items = [
      article("a", "Fed holds rates steady in July", "reuters", { embedding: vec(0) }),
      article("b", "Fed holds rates steady in July decision", "ft", {
        at: 1,
        embedding: vec(1),
      }),
      article("c", "Central bank keeps rates unchanged", "bbc", { at: 2, embedding: vec(1, 0.05) }),
    ];
    const clusters = clusterArticles(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].distinctFeeds).toBe(3);
  });

  it("keeps a story only one outlet carried", () => {
    const [cluster] = clusterArticles([article("a", "A quiet local story", "blog")]);
    expect(cluster.articleIds).toEqual(["a"]);
    expect(cluster.distinctFeeds).toBe(1);
  });

  it("handles undated articles without throwing", () => {
    const items: ClusterableArticle[] = [
      { id: "a", title: "Fed holds interest rates steady", feedId: "r", publishDate: null },
      { id: "b", title: "Fed holds interest rates steady today", feedId: "f", publishDate: null },
    ];
    const clusters = clusterArticles(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].firstSeen).toBeInstanceOf(Date);
  });
});

describe("representativeTitle", () => {
  it("prefers the shared substance over one outlet's editorialising", () => {
    const best = representativeTitle([
      "Fed holds interest rates steady",
      "Fed holds interest rates steady in July",
      "Here is what nobody will tell you about the economy",
    ]);
    expect(best).toContain("Fed holds interest rates steady");
  });

  it("breaks ties towards the shorter headline", () => {
    expect(
      representativeTitle(["Fed holds rates steady", "Fed holds rates steady after meeting"]),
    ).toBe("Fed holds rates steady");
  });

  it("handles empty and single-item input", () => {
    expect(representativeTitle([])).toBe("");
    expect(representativeTitle(["Only one"])).toBe("Only one");
  });
});

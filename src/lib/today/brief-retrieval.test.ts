import { describe, expect, it } from "vitest";
import {
  MAX_TELLINGS_PER_STORY,
  connectedness,
  findThreads,
  rankStories,
  selectBriefQueue,
  toStories,
  type ScanArticle,
} from "./brief-retrieval";
import { OTHER_TOPIC_ID, resolveDesks } from "./topics";

const NOW = new Date("2026-08-24T09:00:00Z");

function article(over: Partial<ScanArticle> & { id: string; title: string }): ScanArticle {
  return {
    feedId: `feed-${over.id}`,
    feedTitle: "A Feed",
    publishDate: NOW,
    trendScore: 0,
    clusterId: null,
    wordCount: null,
    hasFullText: false,
    ...over,
  };
}

/** Six tellings of one story, plus two other stories. */
function scan(): ScanArticle[] {
  return [
    ...Array.from({ length: 6 }, (_, i) =>
      article({
        id: `wire${i}`,
        title: "NATO weighs fresh sanctions on Russia",
        feedId: `outlet${i}`,
        clusterId: "c1",
        trendScore: 0.9,
      }),
    ),
    article({ id: "ai1", title: "OpenAI ships a smaller open weights model", clusterId: "c2" }),
    article({ id: "sec1", title: "Ransomware crew breaches a hospital network", clusterId: "c3" }),
  ];
}

describe("toStories", () => {
  it("collapses tellings of one story and counts distinct feeds", () => {
    const stories = toStories(scan());
    expect(stories).toHaveLength(3);
    const big = stories.find((s) => s.key === "c1")!;
    expect(big.members).toHaveLength(6);
    expect(big.distinctFeeds).toBe(6);
  });

  it("counts feeds, not articles — one outlet cannot manufacture a spread", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      article({ id: `a${i}`, title: "One outlet, four follow-ups", feedId: "same", clusterId: "c" }),
    );
    expect(toStories(rows)[0].distinctFeeds).toBe(1);
  });

  it("gives every unclustered article its own story", () => {
    const rows = [
      article({ id: "a", title: "Alpha" }),
      article({ id: "b", title: "Beta" }),
    ];
    expect(toStories(rows)).toHaveLength(2);
  });

  it("files a story on one desk, taken from its representative headline", () => {
    const stories = toStories(scan());
    expect(stories.find((s) => s.key === "c1")?.deskId).toBe("geopolitics");
    expect(stories.find((s) => s.key === "c2")?.deskId).toBe("ai");
  });

  it("uses the reader's own desks when they have any", () => {
    const desks = resolveDesks([
      { id: "custom:singapore", label: "Singapore", desk: "Singapore", keywords: ["singapore"] },
    ]);
    const rows = [article({ id: "sg", title: "Singapore tightens export rules on China" })];
    expect(toStories(rows, desks)[0].deskId).toBe("custom:singapore");
  });
});

describe("connectedness", () => {
  it("ranks a story sharing vocabulary with others above an isolated one", () => {
    const rows = [
      article({ id: "1", title: "Tariffs hit the semiconductor supply chain" }),
      article({ id: "2", title: "Tariffs raise semiconductor prices for carmakers" }),
      article({ id: "3", title: "Washington widens tariffs on semiconductor tools" }),
      article({ id: "4", title: "A sourdough recipe worth keeping" }),
    ];
    const stories = toStories(rows);
    const scores = connectedness(stories);
    const isolated = stories.findIndex((s) => s.title.includes("sourdough"));
    expect(scores[isolated]).toBe(0);
    for (let i = 0; i < scores.length; i += 1) {
      if (i !== isolated) expect(scores[i]).toBeGreaterThan(0);
    }
  });

  it("is empty for an empty pool and bounded to [0, 1]", () => {
    expect(connectedness([])).toEqual([]);
    for (const v of connectedness(toStories(scan()))) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("rankStories", () => {
  it("puts the widely-corroborated story first", () => {
    const ranked = rankStories(toStories(scan()), { now: NOW });
    expect(ranked[0].key).toBe("c1");
  });

  it("lifts a followed desk above an otherwise equal one", () => {
    const rows = [
      article({ id: "a", title: "OpenAI ships a smaller open weights model", clusterId: "c2" }),
      article({ id: "b", title: "Ransomware crew breaches a hospital network", clusterId: "c3" }),
    ];
    const ranked = rankStories(toStories(rows), { priority: ["security"], now: NOW });
    expect(ranked[0].deskId).toBe("security");
  });

  it("prefers today's story to last week's", () => {
    const rows = [
      article({ id: "old", title: "Alpha happened", publishDate: new Date("2026-08-17T09:00:00Z") }),
      article({ id: "new", title: "Beta happened", publishDate: NOW }),
    ];
    expect(rankStories(toStories(rows), { now: NOW })[0].members[0].id).toBe("new");
  });

  it("still ranks something when nothing has been scored yet", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      article({ id: `a${i}`, title: `Story number ${i}` }),
    );
    expect(rankStories(toStories(rows), { now: NOW })).toHaveLength(5);
  });
});

describe("selectBriefQueue", () => {
  it("keeps at most three tellings of one story", () => {
    const out = selectBriefQueue(scan(), { limit: 20, now: NOW });
    const wire = out.selected.filter((a) => a.clusterId === "c1");
    expect(wire).toHaveLength(MAX_TELLINGS_PER_STORY);
    // The other two stories survive, which is the whole point: six wire copies
    // used to spend six of the queue's slots.
    expect(out.selected).toHaveLength(5);
  });

  it("never returns more than the limit", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      article({ id: `a${i}`, title: `Distinct story ${i}` }),
    );
    expect(selectBriefQueue(rows, { limit: 12, now: NOW }).selected).toHaveLength(12);
  });

  it("reports what the scan saw against what it kept", () => {
    const out = selectBriefQueue(scan(), { limit: 20, now: NOW });
    expect(out.coverage).toEqual({
      scanned: 8,
      stories: 3,
      selectedStories: 3,
      selected: 5,
    });
  });

  it("stops one desk eating the whole queue while others go unread", () => {
    const rows = [
      // Forty separate AI stories, all hot…
      ...Array.from({ length: 40 }, (_, i) =>
        article({
          id: `ai${i}`,
          title: `OpenAI ships model number ${i}`,
          clusterId: `ai-${i}`,
          trendScore: 0.9,
        }),
      ),
      // …and a handful of cooler ones elsewhere.
      ...Array.from({ length: 5 }, (_, i) =>
        article({
          id: `geo${i}`,
          title: `NATO weighs sanctions package ${i}`,
          clusterId: `geo-${i}`,
          trendScore: 0.1,
        }),
      ),
    ];
    const out = selectBriefQueue(rows, { limit: 20, now: NOW });
    expect(out.selected).toHaveLength(20);
    expect(out.selected.some((a) => a.id.startsWith("geo"))).toBe(true);
  });

  it("fills the queue anyway when the reader's feeds really are one subject", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      article({ id: `ai${i}`, title: `OpenAI ships model number ${i}`, clusterId: `ai-${i}` }),
    );
    // The 40% desk ceiling applies on the first pass and is lifted on the
    // second, so a single-desk library still gets a full brief.
    expect(selectBriefQueue(rows, { limit: 20, now: NOW }).selected).toHaveLength(20);
  });

  it("prefers the telling with a fetched body", () => {
    const rows = [
      article({ id: "stub", title: "Fed holds rates steady", clusterId: "c", feedId: "f1" }),
      article({
        id: "full",
        title: "Fed holds rates steady",
        clusterId: "c",
        feedId: "f2",
        hasFullText: true,
        wordCount: 1800,
      }),
    ];
    expect(selectBriefQueue(rows, { limit: 1, now: NOW }).selected[0].id).toBe("full");
  });

  it("carries each story's true spread onto every telling it kept", () => {
    const out = selectBriefQueue(scan(), { limit: 20, now: NOW });
    for (const a of out.selected.filter((x) => x.clusterId === "c1")) {
      expect(out.storyFeeds.get(a.id)).toBe(6);
    }
  });

  it("names the desks it did not reach", () => {
    const rows = [
      article({ id: "ai", title: "OpenAI ships a smaller model", trendScore: 0.9 }),
      article({ id: "sec", title: "Ransomware crew breaches a hospital", trendScore: 0.1 }),
    ];
    const out = selectBriefQueue(rows, { limit: 1, now: NOW });
    expect(out.omitted).toEqual([{ topicId: "security", stories: 1, articles: 1 }]);
  });

  it("puts the catch-all desk last among the omissions", () => {
    const rows = [
      article({ id: "keep", title: "OpenAI ships a smaller model", trendScore: 0.9 }),
      article({ id: "junk", title: "Untitled", trendScore: 0.5 }),
      article({ id: "sec", title: "Ransomware crew breaches a hospital", trendScore: 0.4 }),
    ];
    const out = selectBriefQueue(rows, { limit: 1, now: NOW });
    expect(out.omitted[out.omitted.length - 1].topicId).toBe(OTHER_TOPIC_ID);
  });

  it("is deterministic — the plan, every section and the XP call must agree", () => {
    const rows = scan();
    const a = selectBriefQueue(rows, { limit: 5, priority: ["ai"], now: NOW });
    const b = selectBriefQueue(rows, { limit: 5, priority: ["ai"], now: NOW });
    expect(a.selected.map((x) => x.id)).toEqual(b.selected.map((x) => x.id));
  });

  it("does not renumber the queue as the minutes pass", () => {
    // The plan call and the section calls that follow it are seconds to minutes
    // apart, and every citation in the brief resolves against the numbering the
    // plan handed out. A recency term that moved continuously would let two
    // near-tied stories swap places in between.
    const rows = Array.from({ length: 12 }, (_, i) =>
      article({
        id: `a${i}`,
        title: `Distinct story ${i}`,
        // Minutes apart, so ties are as tight as they ever get in practice.
        publishDate: new Date(NOW.getTime() - i * 90 * 1000),
      }),
    );
    const plan = selectBriefQueue(rows, { limit: 8, now: NOW });
    const later = selectBriefQueue(rows, {
      limit: 8,
      now: new Date(NOW.getTime() + 4 * 60 * 1000),
    });
    expect(later.selected.map((x) => x.id)).toEqual(plan.selected.map((x) => x.id));
  });

  it("handles an empty scan", () => {
    const out = selectBriefQueue([], { limit: 10, now: NOW });
    expect(out.selected).toEqual([]);
    expect(out.coverage.stories).toBe(0);
  });
});

describe("findThreads", () => {
  /** Tariff stories spread across three desks — the shape a desk-by-desk brief
   *  structurally cannot see. */
  function crossDesk(): ScanArticle[] {
    return [
      article({ id: "m1", title: "Tariffs push semiconductor earnings lower", clusterId: "m1" }),
      article({ id: "p1", title: "Brussels opens a tariffs inquiry into semiconductor imports", clusterId: "p1" }),
      article({ id: "g1", title: "Beijing answers semiconductor tariffs with export controls", clusterId: "g1" }),
      article({ id: "x1", title: "A sourdough recipe worth keeping", clusterId: "x1" }),
      article({ id: "x2", title: "Museum reopens after a long refit", clusterId: "x2" }),
    ];
  }

  it("finds a subject running across more than one desk", () => {
    const [thread] = findThreads(toStories(crossDesk()));
    expect(thread).toBeDefined();
    expect(thread.terms).toContain("semiconductor");
    expect(thread.stories).toHaveLength(3);
    expect(thread.deskIds.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a subject confined to one desk — that desk's section covers it", () => {
    const oneDesk = Array.from({ length: 5 }, (_, i) =>
      article({ id: `ai${i}`, title: `OpenAI ships another inference model ${i}`, clusterId: `c${i}` }),
    );
    expect(findThreads(toStories(oneDesk))).toEqual([]);
  });

  it("needs more than a coincidence between two stories", () => {
    const pair = [
      article({ id: "a", title: "Tariffs push semiconductor earnings lower", clusterId: "a" }),
      article({ id: "b", title: "Beijing answers semiconductor tariffs", clusterId: "b" }),
    ];
    expect(findThreads(toStories(pair))).toEqual([]);
  });

  it("never calls a term a thread when it is most of the pool", () => {
    // A reader whose feeds are all one subject must not be told "tariffs" is a
    // thread every single morning.
    const rows = Array.from({ length: 6 }, (_, i) =>
      article({
        id: `t${i}`,
        // Alternates between two desks, so only the share guard can stop it.
        title:
          i % 2 === 0
            ? `Tariffs move semiconductor earnings ${i}`
            : `Brussels tariffs inquiry on semiconductor imports ${i}`,
        clusterId: `c${i}`,
      }),
    );
    for (const t of findThreads(toStories(rows))) {
      expect(t.stories.length).toBeLessThanOrEqual(rows.length * 0.5);
    }
  });

  it("uses each story in at most one thread", () => {
    const threads = findThreads(toStories(crossDesk()), 3);
    const used = threads.flatMap((t) => t.stories);
    expect(new Set(used).size).toBe(used.length);
  });

  it("says nothing about a pool too small to have threads", () => {
    expect(findThreads([])).toEqual([]);
    expect(findThreads(toStories([article({ id: "a", title: "Alpha" })]))).toEqual([]);
  });
});

describe("threads in the selection", () => {
  it("cites threads with the same [n] numbers as everything else", () => {
    const rows = [
      article({ id: "m1", title: "Tariffs push semiconductor earnings lower", clusterId: "m1" }),
      article({ id: "p1", title: "Brussels opens a tariffs inquiry into semiconductor imports", clusterId: "p1" }),
      article({ id: "g1", title: "Beijing answers semiconductor tariffs with export controls", clusterId: "g1" }),
      article({ id: "x1", title: "A sourdough recipe worth keeping", clusterId: "x1" }),
      article({ id: "x2", title: "Museum reopens after a long refit", clusterId: "x2" }),
    ];
    const out = selectBriefQueue(rows, { limit: 20, now: NOW });
    expect(out.threads).toHaveLength(1);
    for (const ref of out.threads[0].refs) {
      expect(ref).toBeGreaterThanOrEqual(1);
      expect(ref).toBeLessThanOrEqual(out.selected.length);
    }
  });

  it("only finds threads among stories the brief can actually cite", () => {
    const rows = [
      article({ id: "m1", title: "Tariffs push semiconductor earnings lower", clusterId: "m1", trendScore: 0.9 }),
      article({ id: "p1", title: "Brussels opens a tariffs inquiry into semiconductor imports", clusterId: "p1" }),
      article({ id: "g1", title: "Beijing answers semiconductor tariffs with export controls", clusterId: "g1" }),
    ];
    // Only one story fits, so there is no thread left to draw.
    expect(selectBriefQueue(rows, { limit: 1, now: NOW }).threads).toEqual([]);
  });
});

describe("feed trust in ranking", () => {
  it("lifts a story carried by feeds the reader actually reads", () => {
    const rows = [
      article({ id: "a1", title: "Alpha development lands today", feedId: "keen1", clusterId: "a" }),
      article({ id: "a2", title: "Alpha development lands today", feedId: "keen2", clusterId: "a" }),
      article({ id: "b1", title: "Beta development lands today", feedId: "dull1", clusterId: "b" }),
      article({ id: "b2", title: "Beta development lands today", feedId: "dull2", clusterId: "b" }),
    ];
    const trust = { keen1: 1.35, keen2: 1.35, dull1: 0.75, dull2: 0.75 };
    const ranked = rankStories(toStories(rows), { feedTrust: trust, now: NOW });
    expect(ranked[0].key).toBe("a");
  });

  it("changes nothing for a reader the app knows nothing about", () => {
    const rows = scan();
    const withTrust = rankStories(toStories(rows), { feedTrust: {}, now: NOW });
    const without = rankStories(toStories(rows), { now: NOW });
    expect(withTrust.map((s) => s.key)).toEqual(without.map((s) => s.key));
  });
});

describe("a followed story in ranking", () => {
  it("keeps it in the queue on the day nothing happened to it", () => {
    const rows = [
      article({ id: "hot", title: "Everyone is covering this today", trendScore: 0.95 }),
      article({
        id: "quiet",
        title: "Nexperia seizure grinds on with no movement",
        trendScore: 0,
        publishDate: new Date(NOW.getTime() - 40 * 60 * 60 * 1000),
      }),
    ];
    const isFollowed = (t: string) => t.includes("Nexperia");
    expect(rankStories(toStories(rows), { isFollowed, now: NOW })[0].members[0].id).toBe("quiet");
    // …and it is only ever a request, never an inference: without the follow the
    // hot story leads, as it should.
    expect(rankStories(toStories(rows), { now: NOW })[0].members[0].id).toBe("hot");
  });
});

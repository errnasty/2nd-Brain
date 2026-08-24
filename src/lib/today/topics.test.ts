import { describe, expect, it } from "vitest";
import {
  BRIEF_TOPICS,
  customDeskId,
  normalizeCustomDesks,
  resolveDesks,
  OTHER_TOPIC_ID,
  classifyArticle,
  groupByTopic,
  scoreTopics,
  topicLabel,
} from "./topics";

describe("classifyArticle", () => {
  it("files world-affairs headlines on the geopolitics desk", () => {
    expect(classifyArticle({ title: "NATO weighs new sanctions on Russia" })).toBe("geopolitics");
    expect(classifyArticle({ title: "Taiwan tensions rise as summit collapses" })).toBe(
      "geopolitics",
    );
  });

  it("files AI headlines on the AI desk", () => {
    expect(classifyArticle({ title: "OpenAI ships a smaller LLM" })).toBe("ai");
    expect(classifyArticle({ title: "AI-powered coding agents hit the enterprise" })).toBe("ai");
    // Parenthesised acronyms normalise to a bare word, so "(AI)" still counts.
    expect(classifyArticle({ title: "Artificial intelligence (AI) in radiology" })).toBe("ai");
  });

  it("uses the feed name when the headline is topically bare", () => {
    expect(classifyArticle({ title: "The Monday edition", feedTitle: "AI Weekly" })).toBe("ai");
    expect(
      classifyArticle({ title: "Notes from the week", feedTitle: "Geopolitics Digest" }),
    ).toBe("geopolitics");
  });

  it("does not file an article on one passing body mention", () => {
    expect(
      classifyArticle({
        title: "A quiet week for the team",
        excerpt: "We shipped a few fixes. Sanctions were mentioned once in passing.",
      }),
    ).toBe(OTHER_TOPIC_ID);
  });

  it("returns other for text no desk claims", () => {
    expect(classifyArticle({ title: "Untitled" })).toBe(OTHER_TOPIC_ID);
    expect(classifyArticle({ title: "" })).toBe(OTHER_TOPIC_ID);
  });

  it("scores the headline above the body for the same term", () => {
    const inTitle = scoreTopics({ title: "Ransomware crew hits a hospital" }).get("security") ?? 0;
    const inBody = scoreTopics({
      title: "Something happened",
      excerpt: "Ransomware crew hits a hospital",
    }).get("security") ?? 0;
    expect(inTitle).toBeGreaterThan(inBody);
  });

  it("is deterministic — same input, same desk", () => {
    const a = { title: "China and the AI export controls", excerpt: "Chips and models." };
    expect(classifyArticle(a)).toBe(classifyArticle(a));
  });
});

describe("groupByTopic", () => {
  const items = [
    { title: "NATO expands its eastern presence" }, // 1 geopolitics
    { title: "OpenAI releases new model weights" }, // 2 ai
    { title: "Ceasefire talks resume in Gaza" }, // 3 geopolitics
    { title: "A recipe for sourdough" }, // 4 other
    { title: "LLM inference costs keep falling" }, // 5 ai
    { title: "Sanctions bite the Kremlin budget" }, // 6 geopolitics
  ];

  it("returns 1-based refs matching the [n] numbering", () => {
    const buckets = groupByTopic(items);
    const geo = buckets.find((b) => b.topicId === "geopolitics");
    expect(geo?.refs).toEqual([1, 3, 6]);
    const ai = buckets.find((b) => b.topicId === "ai");
    expect(ai?.refs).toEqual([2, 5]);
  });

  it("orders by bucket size when no priority is given", () => {
    const buckets = groupByTopic(items);
    expect(buckets[0].topicId).toBe("geopolitics"); // 3 items beats 2
    expect(buckets[1].topicId).toBe("ai");
  });

  it("puts the user's priority desks first, in the order they chose", () => {
    const buckets = groupByTopic(items, { priority: ["ai", "geopolitics"] });
    expect(buckets.map((b) => b.topicId).slice(0, 2)).toEqual(["ai", "geopolitics"]);
  });

  it("keeps other last even when it is the biggest bucket", () => {
    const noise = [
      { title: "A recipe for sourdough" },
      { title: "Untitled draft" },
      { title: "Random notes" },
      { title: "NATO expands its eastern presence" },
    ];
    const buckets = groupByTopic(noise);
    expect(buckets[buckets.length - 1].topicId).toBe(OTHER_TOPIC_ID);
  });

  it("covers every article exactly once", () => {
    const refs = groupByTopic(items).flatMap((b) => b.refs).sort((a, b) => a - b);
    expect(refs).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("topic catalog", () => {
  it("has unique ids and a label for each", () => {
    const ids = BRIEF_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BRIEF_TOPICS) expect(topicLabel(t.id)).toBe(t.label);
  });

  it("labels the fallback desk", () => {
    expect(topicLabel(OTHER_TOPIC_ID)).toBe("Also in your queue");
  });

  it("stores keywords already normalised (lowercase, no punctuation)", () => {
    for (const t of BRIEF_TOPICS) {
      for (const k of [...t.strong, ...t.weak]) {
        expect(k).toBe(k.toLowerCase());
        expect(k).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
      }
    }
  });
});

describe("custom desks", () => {
  const singapore = [
    { id: "custom:singapore", label: "Singapore", desk: "Singapore", keywords: ["singapore", "mas"] },
  ];

  it("claims an article the built-in desks would have taken", () => {
    const desks = resolveDesks(singapore);
    const a = { title: "Singapore tightens chip export rules aimed at Beijing" };
    // Geopolitics scores higher on its own terms — the custom desk still wins,
    // because that is the whole reason somebody adds one.
    expect(classifyArticle(a)).toBe("geopolitics");
    expect(classifyArticle(a, desks)).toBe("custom:singapore");
  });

  it("leaves articles it does not match exactly where they were", () => {
    const desks = resolveDesks(singapore);
    const a = { title: "NATO weighs new sanctions on Russia" };
    expect(classifyArticle(a, desks)).toBe("geopolitics");
  });

  it("matches terms the reader typed with punctuation or capitals", () => {
    const desks = resolveDesks([
      { id: "custom:sea", label: "SEA", desk: "the region", keywords: ["South-East Asia"] },
    ]);
    expect(classifyArticle({ title: "South East Asia braces for a wet season" }, desks)).toBe(
      "custom:sea",
    );
  });

  it("keeps its own label and remit through the desk lookups", () => {
    const desks = resolveDesks(singapore);
    expect(topicLabel("custom:singapore", desks)).toBe("Singapore");
    expect(topicLabel("custom:singapore")).toBe("custom:singapore");
  });

  it("has no effect at all when the reader has defined none", () => {
    expect(resolveDesks()).toBe(BRIEF_TOPICS);
    expect(resolveDesks([])).toBe(BRIEF_TOPICS);
  });
});

describe("normalizeCustomDesks", () => {
  it("drops anything that isn't a desk", () => {
    expect(normalizeCustomDesks(null)).toEqual([]);
    expect(normalizeCustomDesks("nope")).toEqual([]);
    expect(normalizeCustomDesks([null, 3, { label: "" }])).toEqual([]);
  });

  it("falls back to the label when no term survives", () => {
    const [desk] = normalizeCustomDesks([{ label: "Singapore", keywords: ["", 7] }]);
    expect(desk.keywords).toEqual(["singapore"]);
    expect(desk.id).toBe("custom:singapore");
    expect(desk.desk).toContain("Singapore");
  });

  it("derives a namespaced id and keeps a supplied one", () => {
    expect(customDeskId("Semiconductor supply")).toBe("custom:semiconductor-supply");
    expect(customDeskId("!!!")).toBe("custom:desk");
    const [desk] = normalizeCustomDesks([
      { id: "custom:frozen", label: "Renamed since", keywords: ["x"] },
    ]);
    expect(desk.id).toBe("custom:frozen");
  });

  it("deduplicates ids and bounds the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `Desk ${i}`, keywords: ["a"] }));
    expect(normalizeCustomDesks(many).length).toBeLessThanOrEqual(8);
    expect(
      normalizeCustomDesks([
        { label: "Singapore", keywords: ["a"] },
        { label: "singapore", keywords: ["b"] },
      ]),
    ).toHaveLength(1);
  });

  it("never keeps a duplicate term", () => {
    const [desk] = normalizeCustomDesks([
      { label: "Chips", keywords: ["TSMC", "tsmc", " tsmc "] },
    ]);
    expect(desk.keywords).toEqual(["tsmc"]);
  });
});

describe("groupByTopic with clusters", () => {
  const items = [
    { title: "Fed holds rates steady as inflation cools" },
    { title: "No change from the FOMC, say regulators reviewing the ruling" },
    { title: "OpenAI ships a smaller open weights model" },
  ];

  it("splits two tellings of one story without cluster ids", () => {
    const desks = groupByTopic(items).map((b) => b.topicId);
    expect(new Set(desks).size).toBeGreaterThan(2);
  });

  it("keeps every telling of one story on a single desk", () => {
    const buckets = groupByTopic(items, { clusterIds: ["fed", "fed", null] });
    const withFirst = buckets.find((b) => b.refs.includes(1))!;
    expect(withFirst.refs).toContain(2);
  });

  it("prefers a real desk to the catch-all when one telling found one", () => {
    const pair = [{ title: "Untitled" }, { title: "OpenAI ships a smaller open weights model" }];
    const buckets = groupByTopic(pair, { clusterIds: ["c", "c"] });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].topicId).toBe("ai");
  });
});

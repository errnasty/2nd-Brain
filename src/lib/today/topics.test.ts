import { describe, expect, it } from "vitest";
import {
  BRIEF_TOPICS,
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

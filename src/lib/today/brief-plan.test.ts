import { describe, expect, it } from "vitest";
import {
  BRIEF_LEVELS,
  BRIEF_LEVEL_CONFIG,
  briefSettingsKey,
  findSection,
  isBriefLevel,
  leadCandidateRefs,
  planBrief,
  type PlanArticle,
} from "./brief-plan";
import { OTHER_TOPIC_ID } from "./topics";
import {
  MAX_SECTION_TOKENS,
  sectionArticleBlock,
  sectionMaxTokens,
  sectionSystemPrompt,
} from "./brief-prompts";

/** A queue with several clear desks and a few unclassifiable items. */
function queue(): PlanArticle[] {
  return [
    { title: "NATO weighs fresh sanctions on Russia", wordCount: 1400, hasFullText: true },
    { title: "OpenAI ships smaller open weights model" },
    { title: "Ceasefire talks resume as summit collapses" },
    { title: "Ransomware crew breaches a hospital network" },
    { title: "LLM inference costs keep falling", wordCount: 900 },
    { title: "Sanctions bite the Kremlin budget" },
    { title: "A recipe for sourdough" },
    { title: "Untitled draft" },
    { title: "AI agents arrive in the enterprise" },
    { title: "Zero day exploited in the wild" },
  ];
}

describe("isBriefLevel", () => {
  it("accepts the three levels and nothing else", () => {
    for (const l of BRIEF_LEVELS) expect(isBriefLevel(l)).toBe(true);
    expect(isBriefLevel("verbose")).toBe(false);
    expect(isBriefLevel(undefined)).toBe(false);
    expect(isBriefLevel(2)).toBe(false);
  });
});

describe("leadCandidateRefs", () => {
  it("returns at most `count` refs, in ascending order", () => {
    const refs = leadCandidateRefs(queue(), { count: 4 });
    expect(refs).toHaveLength(4);
    expect([...refs].sort((a, b) => a - b)).toEqual(refs);
  });

  it("pulls the desks the user follows into the shortlist", () => {
    // Ref 9 ("AI agents arrive in the enterprise") is a thin, older item: it
    // misses the shortlist on its own merits, and makes it once AI is followed.
    expect(leadCandidateRefs(queue(), { count: 4 })).not.toContain(9);
    expect(leadCandidateRefs(queue(), { priority: ["ai"], count: 4 })).toContain(9);
  });

  it("still ranks a substantial off-desk piece above a thin on-desk one", () => {
    // Ref 1 is a 1,400-word fetched piece; following AI does not bury it.
    expect(leadCandidateRefs(queue(), { priority: ["ai"], count: 2 })).toContain(1);
  });

  it("prefers articles with a fetched body over stubs", () => {
    const items: PlanArticle[] = [
      { title: "Stub one" },
      { title: "Stub two" },
      { title: "Full piece", hasFullText: true, wordCount: 2000 },
    ];
    expect(leadCandidateRefs(items, { count: 1 })).toEqual([3]);
  });

  it("handles a one-article queue and an empty count", () => {
    expect(leadCandidateRefs([{ title: "Only one" }], { count: 5 })).toEqual([1]);
    expect(leadCandidateRefs(queue(), { count: 0 })).toEqual([]);
  });
});

describe("planBrief", () => {
  it("returns nothing to generate for an empty queue", () => {
    const plan = planBrief([], { level: "deep" });
    expect(plan.sections).toEqual([]);
    expect(plan.desks).toEqual([]);
  });

  it("concise is a lead plus a quick clear — no desks", () => {
    const plan = planBrief(queue(), { level: "concise" });
    expect(plan.sections.map((s) => s.key)).toEqual(["lead", "skip"]);
  });

  it("standard adds up to three desks, lead first and skip last", () => {
    const plan = planBrief(queue(), { level: "standard" });
    const keys = plan.sections.map((s) => s.key);
    expect(keys[0]).toBe("lead");
    expect(keys[keys.length - 1]).toBe("skip");
    expect(keys.filter((k) => k.startsWith("topic:"))).toHaveLength(3);
  });

  it("deep goes wider and includes the catch-all desk", () => {
    const plan = planBrief(queue(), { level: "deep" });
    const topics = plan.sections.filter((s) => s.kind === "topic");
    expect(topics.length).toBeGreaterThan(3);
    expect(topics.some((s) => s.topicId === OTHER_TOPIC_ID)).toBe(true);
  });

  it("puts the user's desks first among the topic sections", () => {
    const plan = planBrief(queue(), { level: "standard", priority: ["security"] });
    const firstTopic = plan.sections.find((s) => s.kind === "topic");
    expect(firstTopic?.topicId).toBe("security");
  });

  it("caps the articles handed to any single desk section", () => {
    const many: PlanArticle[] = Array.from({ length: 30 }, (_, i) => ({
      title: `OpenAI ships model number ${i}`,
    }));
    const plan = planBrief(many, { level: "standard" });
    const ai = plan.sections.find((s) => s.topicId === "ai");
    expect(ai?.refs.length).toBe(BRIEF_LEVEL_CONFIG.standard.maxTopicRefs);
  });

  it("gives the skip section the whole queue (titles only, so it stays cheap)", () => {
    const items = queue();
    const plan = planBrief(items, { level: "standard" });
    expect(findSection(plan, "skip")?.refs).toHaveLength(items.length);
  });

  it("reports desks it left out so the UI can offer more depth", () => {
    const plan = planBrief(queue(), { level: "standard" });
    expect(plan.desks.length).toBeGreaterThan(3);
    expect(plan.desks.filter((d) => d.included)).toHaveLength(3);
  });

  it("only ever cites refs that exist in the queue", () => {
    const items = queue();
    for (const level of BRIEF_LEVELS) {
      for (const s of planBrief(items, { level }).sections) {
        for (const ref of s.refs) {
          expect(ref).toBeGreaterThanOrEqual(1);
          expect(ref).toBeLessThanOrEqual(items.length);
        }
      }
    }
  });

  it("is deterministic for the same queue and settings", () => {
    const a = planBrief(queue(), { level: "deep", priority: ["ai"] });
    const b = planBrief(queue(), { level: "deep", priority: ["ai"] });
    expect(a).toEqual(b);
  });

  it("keeps every section small enough to generate in one short request", () => {
    const items = queue();
    for (const level of BRIEF_LEVELS) {
      const cfg = BRIEF_LEVEL_CONFIG[level];
      for (const s of planBrief(items, { level }).sections) {
        if (s.kind === "topic") expect(s.refs.length).toBeLessThanOrEqual(cfg.maxTopicRefs);
        if (s.kind === "lead") expect(s.refs.length).toBeLessThanOrEqual(cfg.leadCandidates);
        expect(sectionMaxTokens(s, level)).toBeLessThanOrEqual(MAX_SECTION_TOKENS);
      }
    }
  });
});

describe("briefSettingsKey", () => {
  it("changes with the level and with the followed desks", () => {
    expect(briefSettingsKey("standard", [])).not.toBe(briefSettingsKey("deep", []));
    expect(briefSettingsKey("deep", ["ai"])).not.toBe(briefSettingsKey("deep", ["geopolitics"]));
    expect(briefSettingsKey("deep", ["ai"])).toBe(briefSettingsKey("deep", ["ai"]));
  });
});

describe("sectionSystemPrompt", () => {
  const plan = planBrief(queue(), { level: "deep", priority: ["geopolitics"] });

  it("names the desk and its remit in a topic prompt", () => {
    const geo = plan.sections.find((s) => s.topicId === "geopolitics")!;
    const prompt = sectionSystemPrompt(geo, "deep");
    expect(prompt).toContain("Geopolitics & World Affairs");
    expect(prompt).toContain("diplomacy");
  });

  it("forbids inventing citations and headings in every section", () => {
    for (const s of plan.sections) {
      const prompt = sectionSystemPrompt(s, "deep");
      expect(prompt).toContain("Never invent a number");
      expect(prompt).toContain("No section heading");
    }
  });

  it("asks for watch lines and open questions only at depth", () => {
    const lead = findSection(plan, "lead")!;
    expect(sectionSystemPrompt(lead, "deep")).toContain("*Watch:*");
    expect(sectionSystemPrompt(lead, "standard")).not.toContain("*Watch:*");
    const topic = plan.sections.find((s) => s.kind === "topic")!;
    expect(sectionSystemPrompt(topic, "deep")).toContain("*Open question:*");
    expect(sectionSystemPrompt(topic, "standard")).not.toContain("*Open question:*");
  });
});

describe("sectionArticleBlock", () => {
  const inputs = [
    { n: 1, title: "First", feedTitle: "Feed A", body: "x".repeat(5000) },
    { n: 2, title: "Second", feedTitle: "Feed B", body: "short body" },
  ];

  it("truncates bodies to the level's budget", () => {
    const lead = findSection(planBrief(queue(), { level: "concise" }), "lead")!;
    const block = sectionArticleBlock(lead, inputs, "concise");
    expect(block.length).toBeLessThan(BRIEF_LEVEL_CONFIG.concise.bodyChars + 200);
    expect(block).toContain("[1] (Feed A) First");
  });

  it("sends titles only for the skip section", () => {
    const skip = findSection(planBrief(queue(), { level: "concise" }), "skip")!;
    const block = sectionArticleBlock(skip, inputs, "concise");
    expect(block).toBe("[1] (Feed A) First\n\n[2] (Feed B) Second");
  });
});

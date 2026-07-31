import { describe, expect, it } from "vitest";
import {
  BRIEF_LEVELS,
  BRIEF_LEVEL_CONFIG,
  briefSettingsKey,
  findSection,
  isBriefLevel,
  deskRefs,
  leadCandidateRefs,
  planBrief,
  storyGroupsFor,
  type PlanArticle,
} from "./brief-plan";
import { OTHER_TOPIC_ID } from "./topics";
import {
  MAX_SECTION_TOKENS,
  externalBlock,
  sectionArticleBlock,
  sectionMaxTokens,
  sectionSystemPrompt,
  storyBlock,
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

// ── Story clustering in the plan ────────────────────────────────────────
// The trending pass groups syndicated copy into one cluster. The planner has to
// spend its limited slots on distinct STORIES rather than on repeated tellings
// of the same one — that's most of where the brief's extra coverage comes from.

/** Five articles: three are the same story, two are separate. */
function clusteredQueue(): PlanArticle[] {
  return [
    { title: "NATO weighs fresh sanctions on Russia", clusterId: "c1", trendScore: 0.9 },
    { title: "Sanctions package advances in Brussels", clusterId: "c1", trendScore: 0.9 },
    { title: "Russia sanctions move forward, say envoys", clusterId: "c1", trendScore: 0.9 },
    { title: "OpenAI ships smaller open weights model", clusterId: "c2", trendScore: 0.4 },
    { title: "Ransomware crew breaches a hospital network", clusterId: "c3", trendScore: 0.2 },
  ];
}

describe("storyGroupsFor", () => {
  it("returns only refs that share a cluster, sorted", () => {
    const groups = storyGroupsFor(clusteredQueue(), [1, 2, 3, 4, 5]);
    expect(groups).toEqual([{ refs: [1, 2, 3], sourceCount: 3 }]);
  });

  it("ignores unclustered articles entirely", () => {
    const items: PlanArticle[] = [{ title: "a" }, { title: "b" }];
    expect(storyGroupsFor(items, [1, 2])).toEqual([]);
  });

  it("only reports the refs it was given", () => {
    expect(storyGroupsFor(clusteredQueue(), [1, 4, 5])).toEqual([]);
  });
});

describe("leadCandidateRefs with clusters", () => {
  it("offers each story once rather than three copies of the hottest one", () => {
    const refs = leadCandidateRefs(clusteredQueue(), { count: 3 });
    expect(refs).toHaveLength(3);
    // One from c1 (whichever ranked first), plus c2 and c3.
    expect(refs).toContain(4);
    expect(refs).toContain(5);
    expect(refs.filter((r) => r <= 3)).toHaveLength(1);
  });

  it("ranks a hot story above a cold one that is otherwise stronger", () => {
    const items: PlanArticle[] = [
      { title: "A long considered essay", wordCount: 2000, hasFullText: true, trendScore: 0 },
      { title: "Breaking: everyone is covering this", trendScore: 0.95 },
    ];
    expect(leadCandidateRefs(items, { count: 1 })).toEqual([2]);
  });

  it("still works when nothing has been scored yet", () => {
    const refs = leadCandidateRefs(queue(), { count: 4 });
    expect(refs).toHaveLength(4);
    expect(new Set(refs).size).toBe(4);
  });
});

describe("deskRefs", () => {
  it("caps tellings per story so a desk covers more developments", () => {
    const items: PlanArticle[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        title: `Wire copy ${i}`,
        clusterId: "big",
      })),
      { title: "A second development", clusterId: "other" },
      { title: "A third development", clusterId: "third" },
    ];
    const refs = deskRefs(items, [1, 2, 3, 4, 5, 6, 7, 8], 5);
    // Three of the six wire copies, then both other stories — instead of five
    // copies of one story and nothing else.
    expect(refs).toEqual([1, 2, 3, 7, 8]);
  });

  it("respects the article cap", () => {
    const items = clusteredQueue();
    expect(deskRefs(items, [1, 2, 3, 4, 5], 2)).toHaveLength(2);
  });

  it("passes unclustered refs through untouched", () => {
    const items: PlanArticle[] = Array.from({ length: 4 }, (_, i) => ({ title: `a${i}` }));
    expect(deskRefs(items, [1, 2, 3, 4], 3)).toEqual([1, 2, 3]);
  });
});

describe("planBrief with clusters and externals", () => {
  it("annotates sections with their same-story groups", () => {
    const plan = planBrief(clusteredQueue(), { level: "deep" });
    const skip = findSection(plan, "skip");
    expect(skip?.stories).toEqual([{ refs: [1, 2, 3], sourceCount: 3 }]);
  });

  it("adds an external section when candidates are supplied", () => {
    const plan = planBrief(queue(), {
      level: "standard",
      externals: [
        { title: "A huge story you missed", url: "https://x.com/1", outlet: "Reuters" },
        { title: "Another one", url: "https://x.com/2" },
      ],
    });
    const external = findSection(plan, "external");
    expect(external?.kind).toBe("external");
    // Own numbering space: externals must never claim an [n] that resolves to
    // an article in the user's queue.
    expect(external?.refs).toEqual([]);
    expect(external?.externals?.map((e) => e.n)).toEqual([1, 2]);
  });

  it("omits the external section at a level that does not include one", () => {
    const plan = planBrief(queue(), {
      level: "concise",
      externals: [{ title: "A huge story", url: "https://x.com/1" }],
    });
    expect(findSection(plan, "external")).toBeNull();
  });

  it("omits the external section when there are no candidates", () => {
    const plan = planBrief(queue(), { level: "deep", externals: [] });
    expect(findSection(plan, "external")).toBeNull();
  });

  it("caps externals at the level's allowance", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Story ${i}`,
      url: `https://x.com/${i}`,
    }));
    const plan = planBrief(queue(), { level: "standard", externals: many });
    expect(findSection(plan, "external")?.externals).toHaveLength(
      BRIEF_LEVEL_CONFIG.standard.externalPicks,
    );
  });
});

describe("external section prompt", () => {
  const plan = planBrief(queue(), {
    level: "deep",
    externals: [{ title: "A huge story", url: "https://x.com/1", outlet: "Reuters" }],
  });
  const section = findSection(plan, "external")!;

  it("tells the model to use E-numbers and never a plain one", () => {
    const prompt = sectionSystemPrompt(section, "deep");
    expect(prompt).toContain("[E2]");
    expect(prompt.toLowerCase()).toContain("never cite a plain number");
  });

  // No article text was fetched for these — the prompt has to say so, or the
  // model will confidently expand a headline into detail it was never given.
  it("warns that only headlines are available", () => {
    expect(sectionSystemPrompt(section, "deep")).toContain("only headlines");
  });

  it("stays within the section token ceiling", () => {
    expect(sectionMaxTokens(section, "deep")).toBeLessThanOrEqual(MAX_SECTION_TOKENS);
  });

  it("renders each external with its E-number", () => {
    expect(externalBlock(section)).toContain("[E1] (Reuters) A huge story");
  });
});

describe("storyBlock", () => {
  it("states the groups once, not per member", () => {
    const plan = planBrief(clusteredQueue(), { level: "deep" });
    const block = storyBlock(findSection(plan, "skip")!);
    expect(block).toContain("[1] [2] [3] — one story, 3 outlets");
    expect(block.match(/one story/g)).toHaveLength(1);
  });

  it("is empty when no story has more than one telling", () => {
    const plan = planBrief(queue(), { level: "deep" });
    expect(storyBlock(findSection(plan, "skip")!)).toBe("");
  });
});

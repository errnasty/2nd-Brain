import { describe, expect, it } from "vitest";
import {
  BRIEF_LEVELS,
  BRIEF_LEVEL_CONFIG,
  briefSettingsKey,
  coveredRefs,
  findSection,
  isBriefLevel,
  deskRefs,
  estimateBriefMinutes,
  estimateBriefWords,
  leadCandidateRefs,
  planBrief,
  storyGroupsFor,
  type BriefPlan,
  type PlanArticle,
} from "./brief-plan";
import { OTHER_TOPIC_ID, resolveDesks } from "./topics";
import {
  MAX_BRIEF_INSTRUCTIONS,
  MAX_SECTION_TOKENS,
  continuityBlock,
  normalizeBriefInstructions,
  externalBlock,
  readContextBlock,
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

  it("keeps the quick-clear list to what no other section covered", () => {
    const items = queue();
    const plan = planBrief(items, { level: "standard" });
    const written = new Set(
      plan.sections.filter((s) => s.kind === "topic").flatMap((s) => s.refs),
    );
    const skip = findSection(plan, "skip")?.refs ?? [];
    expect(written.size).toBeGreaterThan(0);
    for (const ref of skip) expect(written.has(ref)).toBe(false);
    // …and everything else is still accounted for, so nothing falls off the
    // end of the brief unmentioned.
    expect(new Set([...skip, ...written]).size).toBe(items.length);
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

describe("dedup across sections", () => {
  /** One geopolitics story in three tellings, plus three more on the desk. */
  function deskQueue(): PlanArticle[] {
    return [
      { title: "NATO weighs fresh sanctions on Russia", clusterId: "c1" },
      { title: "Sanctions package advances in Brussels", clusterId: "c1" },
      { title: "Russia sanctions move forward, say envoys", clusterId: "c1" },
      { title: "Taiwan summit collapses as envoys walk out", clusterId: "c2" },
      { title: "Iran ceasefire talks resume in Brussels", clusterId: "c3" },
      { title: "Ukraine drone strike hits a Kremlin depot", clusterId: "c4" },
    ];
  }

  it("drops a covered ref and every other telling of the same story", () => {
    expect([...coveredRefs(deskQueue(), [1])]).toEqual([1, 2, 3]);
  });

  it("ignores refs that are not in the queue", () => {
    expect([...coveredRefs(deskQueue(), [0, 99, -1])]).toEqual([]);
    expect([...coveredRefs(deskQueue(), undefined)]).toEqual([]);
  });

  it("keeps a covered story off the desk that would have written it up again", () => {
    const before = planBrief(deskQueue(), { level: "deep" });
    const after = planBrief(deskQueue(), { level: "deep", covered: [1] });
    const deskOf = (p: typeof before) =>
      p.sections.find((x) => x.topicId === "geopolitics")?.refs ?? [];
    expect(deskOf(before)).toContain(1);
    for (const ref of [1, 2, 3]) expect(deskOf(after)).not.toContain(ref);
  });

  it("backfills the freed slots instead of shrinking the desk", () => {
    // A desk with more material than its cap, whose top story is three
    // tellings of one event. Removing that story should pull three further
    // developments in — dedup and coverage are the same edit.
    const cap = BRIEF_LEVEL_CONFIG.deep.maxTopicRefs;
    const items: PlanArticle[] = [
      { title: "NATO weighs fresh sanctions on Russia", clusterId: "c1" },
      { title: "Sanctions package advances in Brussels", clusterId: "c1" },
      { title: "Russia sanctions move forward, say envoys", clusterId: "c1" },
      ...Array.from({ length: cap + 3 }, (_, i) => ({
        title: `Ukraine drone strike hits depot number ${i}`,
        clusterId: `c${i + 2}`,
      })),
    ];
    const deskOf = (p: BriefPlan) =>
      p.sections.find((x) => x.topicId === "geopolitics")?.refs ?? [];
    const before = deskOf(planBrief(items, { level: "deep" }));
    const after = deskOf(planBrief(items, { level: "deep", covered: [1] }));

    expect(before).toHaveLength(cap);
    // Still a full desk, and every slot the covered story held has been spent
    // on something the reader would otherwise not have been told about.
    expect(after).toHaveLength(cap);
    for (const ref of [1, 2, 3]) expect(after).not.toContain(ref);
    expect(after.filter((r) => !before.includes(r))).toHaveLength(3);
  });

  it("keeps an emptied desk in the plan, with no refs", () => {
    // The client planned WITHOUT `covered` — the lead had not been written yet
    // — so it already holds a block for this desk and will ask for it by key.
    // Dropping the section here would turn "nothing left to say" into a section
    // that fails to load; the route answers the empty ref list instead.
    const items: PlanArticle[] = [
      { title: "NATO weighs fresh sanctions on Russia", clusterId: "c1" },
      { title: "OpenAI ships a smaller open weights model", clusterId: "c2" },
    ];
    const uncovered = planBrief(items, { level: "deep" });
    const covered = planBrief(items, { level: "deep", covered: [1] });
    // Same shape either way — that is the invariant the client depends on.
    expect(covered.sections.map((x) => x.key)).toEqual(uncovered.sections.map((x) => x.key));
    expect(covered.sections.find((x) => x.topicId === "geopolitics")?.refs).toEqual([]);
  });

  it("never offers the quick-clear list something the brief wrote up", () => {
    const items = deskQueue();
    const plan = planBrief(items, { level: "deep", covered: [1] });
    const written = new Set([
      ...plan.sections.filter((x) => x.kind === "topic").flatMap((x) => x.refs),
      1,
      2,
      3,
    ]);
    for (const ref of findSection(plan, "skip")?.refs ?? []) {
      expect(written.has(ref)).toBe(false);
    }
  });

  it("caps the quick-clear list however long the queue is", () => {
    const many: PlanArticle[] = Array.from({ length: 200 }, (_, i) => ({
      title: `Untitled draft ${i}`,
    }));
    const plan = planBrief(many, { level: "concise" });
    expect(findSection(plan, "skip")?.refs.length).toBeLessThanOrEqual(60);
  });
});

describe("custom desks in the plan", () => {
  const desks = resolveDesks([
    { id: "custom:singapore", label: "Singapore", desk: "Singapore", keywords: ["singapore"] },
  ]);

  function sgQueue(): PlanArticle[] {
    return [
      { title: "Singapore tightens chip export rules aimed at Beijing" },
      { title: "MAS holds policy as Singapore inflation cools" },
      { title: "OpenAI ships a smaller open weights model" },
      { title: "Ransomware crew breaches a hospital network" },
    ];
  }

  it("gets its own section, under its own name", () => {
    const plan = planBrief(sgQueue(), { level: "deep", desks });
    const section = plan.sections.find((s) => s.topicId === "custom:singapore");
    expect(section?.label).toBe("Singapore");
    expect(section?.refs).toContain(1);
  });

  it("leads the brief when it is followed", () => {
    const plan = planBrief(sgQueue(), {
      level: "standard",
      desks,
      priority: ["custom:singapore"],
    });
    expect(plan.sections.find((s) => s.kind === "topic")?.topicId).toBe("custom:singapore");
  });

  it("changes nothing for a reader who has none", () => {
    const plan = planBrief(sgQueue(), { level: "deep" });
    expect(plan.desks.some((d) => d.topicId.startsWith("custom:"))).toBe(false);
  });
});

describe("standing instructions", () => {
  const plan = planBrief(queue(), { level: "deep" });
  const lead = findSection(plan, "lead")!;
  const desk = plan.sections.find((s) => s.kind === "topic")!;
  const skip = findSection(plan, "skip")!;
  const instructions = "Write in British English.\nSkip anything about crypto.";

  it("reaches every section, not just the lead", () => {
    for (const section of [lead, desk, skip]) {
      const prompt = sectionSystemPrompt(section, "deep", { instructions });
      expect(prompt).toContain("Write in British English.");
      expect(prompt).toContain("Skip anything about crypto.");
    }
  });

  it("is absent entirely when the reader has written none", () => {
    expect(sectionSystemPrompt(lead, "deep")).not.toContain("Standing instructions");
    expect(sectionSystemPrompt(lead, "deep", { instructions: "" })).not.toContain(
      "Standing instructions",
    );
  });

  it("leaves the section's own rules intact and above it", () => {
    const plain = sectionSystemPrompt(desk, "deep");
    const withInstructions = sectionSystemPrompt(desk, "deep", { instructions });
    // Layered, not an override: the whole base prompt is still there, and the
    // instructions are appended after it.
    expect(withInstructions.startsWith(plain)).toBe(true);
  });

  it("says plainly that it cannot break the citation contract", () => {
    const prompt = sectionSystemPrompt(desk, "deep", { instructions });
    expect(prompt).toContain("do not override the rules above");
    expect(prompt.indexOf("Never invent a number")).toBeLessThan(
      prompt.indexOf("Standing instructions"),
    );
  });
});

describe("normalizeBriefInstructions", () => {
  it("drops anything that is not text", () => {
    expect(normalizeBriefInstructions(null)).toBe("");
    expect(normalizeBriefInstructions(42)).toBe("");
    expect(normalizeBriefInstructions("   ")).toBe("");
  });

  it("trims and bounds", () => {
    expect(normalizeBriefInstructions("  be blunt  ")).toBe("be blunt");
    expect(normalizeBriefInstructions("x".repeat(9000))).toHaveLength(MAX_BRIEF_INSTRUCTIONS);
  });
});

describe("briefSettingsKey", () => {
  it("changes when the instructions are rewritten", () => {
    const base = briefSettingsKey("deep", [], []);
    expect(briefSettingsKey("deep", [], [], "be blunt")).not.toBe(base);
    expect(briefSettingsKey("deep", [], [], "be blunt")).not.toBe(
      briefSettingsKey("deep", [], [], "be verbose"),
    );
  });

  it("changes when a custom desk is added or retuned", () => {
    const base = briefSettingsKey("deep", []);
    const withDesk = briefSettingsKey("deep", [], [
      { id: "custom:sg", label: "Singapore", desk: "Singapore", keywords: ["singapore"] },
    ]);
    const retuned = briefSettingsKey("deep", [], [
      { id: "custom:sg", label: "Singapore", desk: "Singapore", keywords: ["singapore", "mas"] },
    ]);
    expect(withDesk).not.toBe(base);
    expect(retuned).not.toBe(withDesk);
  });

  it("does not change with the order the desks happen to be stored in", () => {
    const a = { id: "custom:a", label: "A", desk: "a", keywords: ["a"] };
    const b = { id: "custom:b", label: "B", desk: "b", keywords: ["b"] };
    expect(briefSettingsKey("deep", [], [a, b])).toBe(briefSettingsKey("deep", [], [b, a]));
  });

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
    const desk = plan.sections.find((s) => s.topicId === "geopolitics");
    expect(desk?.stories).toEqual([{ refs: [1, 2, 3], sourceCount: 3 }]);
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
    const desk = plan.sections.find((s) => s.topicId === "geopolitics")!;
    const block = storyBlock(desk);
    expect(block).toContain("[1] [2] [3] — one story, 3 outlets");
    expect(block.match(/one story/g)).toHaveLength(1);
  });

  it("is empty when no story has more than one telling", () => {
    const plan = planBrief(queue(), { level: "deep" });
    expect(storyBlock(findSection(plan, "skip")!)).toBe("");
  });

  it("reports the story's true spread, not just the refs that fit", () => {
    // Retrieval keeps three tellings of a story six outlets ran. The brief
    // still has to be able to say six — that is most of why it leads.
    const items: PlanArticle[] = [
      { title: "Wire copy one", clusterId: "big", storyFeeds: 6 },
      { title: "Wire copy two", clusterId: "big", storyFeeds: 6 },
      { title: "Wire copy three", clusterId: "big", storyFeeds: 6 },
    ];
    expect(storyGroupsFor(items, [1, 2, 3])).toEqual([
      { refs: [1, 2, 3], sourceCount: 6 },
    ]);
  });
});

describe("estimateBriefMinutes", () => {
  it("gives every level a whole number of minutes, in order", () => {
    const [concise, standard, deep] = BRIEF_LEVELS.map((l) => estimateBriefMinutes(l));
    expect(concise).toBeGreaterThanOrEqual(1);
    expect(standard).toBeGreaterThan(concise);
    expect(deep).toBeGreaterThan(standard);
  });

  it("tracks the knobs rather than a written-down number", () => {
    // The whole point of deriving it: a level that generates more desks has to
    // report a longer read, with nothing else edited.
    const full = estimateBriefWords("deep");
    const halved = estimateBriefWords("deep", { topics: BRIEF_LEVEL_CONFIG.deep.maxTopics / 2 });
    expect(halved).toBeLessThan(full);
  });

  it("estimates against the desks actually planned, not the ceiling", () => {
    const quiet = estimateBriefMinutes("standard", { topics: 1 });
    expect(quiet).toBeLessThan(estimateBriefMinutes("standard"));
  });

  it("never promises a zero-minute brief", () => {
    expect(estimateBriefMinutes("concise", { topics: 0, externals: 0 })).toBeGreaterThanOrEqual(1);
  });
});

describe("continuity markers", () => {
  const NOW = new Date("2026-08-04T08:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  const memory = [
    {
      title: "NATO weighs fresh sanctions on Russia",
      firstBriefedAt: daysAgo(2),
      lastBriefedAt: daysAgo(1),
    },
  ];

  it("marks a lead ref the brief has covered before", () => {
    const plan = planBrief(queue(), { level: "standard", memory, now: NOW });
    const lead = findSection(plan, "lead")!;
    expect(lead.continuing).toEqual([{ ref: 1, since: "2 days ago" }]);
  });

  it("marks the same story on its desk section too", () => {
    const plan = planBrief(queue(), { level: "deep", memory, now: NOW });
    const marked = plan.sections
      .filter((s) => s.kind === "topic")
      .flatMap((s) => s.continuing ?? []);
    expect(marked.map((c) => c.ref)).toContain(1);
  });

  it("marks nothing when the brief has no memory", () => {
    const plan = planBrief(queue(), { level: "standard", now: NOW });
    expect(findSection(plan, "lead")!.continuing).toEqual([]);
  });

  it("does not claim continuity with a story first briefed today", () => {
    const plan = planBrief(queue(), {
      level: "standard",
      memory: [
        {
          title: "NATO weighs fresh sanctions on Russia",
          firstBriefedAt: NOW.toISOString(),
          lastBriefedAt: NOW.toISOString(),
        },
      ],
      now: NOW,
    });
    expect(findSection(plan, "lead")!.continuing).toEqual([]);
  });

  it("renders one line per continuing ref, keyed by number", () => {
    const plan = planBrief(queue(), { level: "standard", memory, now: NOW });
    const block = continuityBlock(findSection(plan, "lead")!);
    expect(block).toContain("[1] — I was first briefed on this 2 days ago");
    expect(continuityBlock(findSection(plan, "skip")!)).toBe("");
  });

  it("only tells the model about continuity when there is some", () => {
    const lead = findSection(planBrief(queue(), { level: "standard", memory, now: NOW }), "lead")!;
    const plain = findSection(planBrief(queue(), { level: "standard", now: NOW }), "lead")!;
    expect(sectionSystemPrompt(lead, "standard", { continuing: true })).toContain("briefed on before");
    expect(sectionSystemPrompt(plain, "standard")).not.toContain("briefed on before");
  });

  it("keeps already-read background out of the citable namespace", () => {
    const block = readContextBlock([{ title: "A piece I read", feedTitle: "Reuters" }]);
    expect(block).toContain("must never be cited");
    expect(block).not.toMatch(/\[\d+\]/);
    expect(readContextBlock([])).toBe("");
  });
});

describe("desk feedback in the plan", () => {
  /** A queue with several desks, so the ordering has something to reorder. */
  function multiDesk(): PlanArticle[] {
    return [
      { title: "Ransomware crew breaches a hospital network" },
      { title: "Zero day exploited in the wild" },
      { title: "OpenAI ships smaller open weights model" },
      { title: "LLM inference costs keep falling" },
      { title: "AI agents arrive in the enterprise" },
    ];
  }

  it("moves a desk the reader asked for more of ahead of the neutral ones", () => {
    const plain = planBrief(multiDesk(), { level: "standard" });
    const boosted = planBrief(multiDesk(), {
      level: "standard",
      deskWeights: { security: 1 },
    });
    const firstDesk = (p: ReturnType<typeof planBrief>) =>
      p.sections.find((s) => s.kind === "topic")?.topicId;
    // AI leads on size alone; a thumbs-up on security overtakes it.
    expect(firstDesk(plain)).toBe("ai");
    expect(firstDesk(boosted)).toBe("security");
  });

  it("pushes a down-voted desk behind the rest", () => {
    const demoted = planBrief(multiDesk(), { level: "standard", deskWeights: { ai: -1 } });
    const topicIds = demoted.sections.filter((s) => s.kind === "topic").map((s) => s.topicId);
    expect(topicIds[topicIds.length - 1]).toBe("ai");
  });

  it("does not overrule a desk the reader explicitly follows", () => {
    // Feedback is worth 2 points against the followed-desk bonus's 3, so a
    // followed desk still leads the shortlist.
    const refs = leadCandidateRefs(multiDesk(), {
      priority: ["security"],
      count: 1,
      deskWeights: { ai: 1 },
    });
    expect(refs).toEqual([1]);
  });

  it("changes nothing for a reader who has never rated a section", () => {
    const withEmpty = planBrief(multiDesk(), { level: "standard", deskWeights: {} });
    const without = planBrief(multiDesk(), { level: "standard" });
    expect(withEmpty.sections.map((s) => s.key)).toEqual(without.sections.map((s) => s.key));
  });
});

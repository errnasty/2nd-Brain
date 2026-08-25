import { describe, expect, it } from "vitest";
import {
  MIN_TRUST,
  MAX_TRUST,
  engagementRate,
  feedTrust,
  trustedFeedCount,
} from "./feed-trust";
import {
  MAX_FOLLOWED_STORIES,
  addFollow,
  followMatcher,
  isLapsed,
  matchFollowed,
  normalizeFollowedStories,
  removeFollow,
  touchFollows,
  type FollowedStory,
} from "./story-follow";
import { isRuledOut, normalizeMisfiles, suggestDesks } from "./desk-suggest";
import {
  citedRefsIn,
  outOfScopeRefs,
  parseVerification,
  MAX_REPORTED_CLAIMS,
} from "./brief-verify";
import { resolveDesks } from "./topics";

const NOW = new Date("2026-08-24T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// ── Feed trust ──────────────────────────────────────────────────────────

describe("feedTrust", () => {
  const feed = (feedId: string, delivered: number, read: number, saved = 0) => ({
    feedId,
    delivered,
    read,
    saved,
  });

  it("weighs a saved article far above a read one", () => {
    expect(engagementRate(feed("a", 10, 4, 0))).toBeLessThan(engagementRate(feed("b", 10, 0, 4)));
  });

  it("ranks a feed you read above one you never open", () => {
    const trust = feedTrust([feed("keen", 40, 30, 8), feed("ignored", 40, 2, 0)]);
    expect(trust.keen).toBeGreaterThan(trust.ignored);
  });

  it("never silences a feed, and never lets one run away", () => {
    const trust = feedTrust([feed("keen", 40, 40, 40), feed("ignored", 400, 0, 0)]);
    for (const v of Object.values(trust)) {
      expect(v).toBeGreaterThanOrEqual(MIN_TRUST);
      expect(v).toBeLessThanOrEqual(MAX_TRUST);
    }
  });

  it("says nothing at all about a reader with no history", () => {
    expect(feedTrust([])).toEqual({});
    expect(feedTrust([feed("a", 2, 2, 1), feed("b", 3, 0, 0)])).toEqual({});
  });

  it("has no opinion when only one feed is eligible", () => {
    // A ratio against your own mean is meaningless with a sample of one.
    expect(feedTrust([feed("a", 40, 20, 5), feed("b", 3, 3, 3)])).toEqual({});
  });

  it("is centred on the reader, not on an absolute reading rate", () => {
    // A completionist and a skimmer must both get a usable ranking of their
    // own feeds rather than "all good" and "all bad".
    const completionist = feedTrust([feed("a", 50, 50, 10), feed("b", 50, 45, 0)]);
    const skimmer = feedTrust([feed("a", 50, 5, 1), feed("b", 50, 1, 0)]);
    expect(completionist.a).toBeGreaterThan(completionist.b);
    expect(skimmer.a).toBeGreaterThan(skimmer.b);
  });
});

describe("trustedFeedCount", () => {
  it("counts distinct feeds, weighted by what they earned", () => {
    expect(trustedFeedCount(["a", "a", "b"], {})).toBe(2);
    expect(trustedFeedCount(["a", "b"], { a: 1.3, b: 0.8 })).toBeCloseTo(2.1);
  });

  it("is the plain distinct count when nothing is known", () => {
    expect(trustedFeedCount(["a", "b", "c"], {})).toBe(3);
  });
});

// ── Following a story ───────────────────────────────────────────────────

describe("story follows", () => {
  const follow = (title: string, days = 0): FollowedStory => ({
    title,
    followedAt: daysAgo(days).toISOString(),
    lastSeenAt: daysAgo(days).toISOString(),
  });

  it("matches tomorrow's telling of the same story", () => {
    const followed = [follow("Nexperia seizure escalates as Beijing responds")];
    expect(matchFollowed("Nexperia seizure escalates, Beijing responds", followed)).not.toBeNull();
    expect(matchFollowed("A sourdough recipe worth keeping", followed)).toBeNull();
  });

  it("refreshes rather than duplicating when the same story is followed twice", () => {
    const once = addFollow([], "Nexperia seizure escalates as Beijing responds", NOW);
    const twice = addFollow(once, "Nexperia seizure escalates, Beijing responds", NOW);
    expect(twice).toHaveLength(1);
  });

  it("drops the oldest when the list is full", () => {
    const titles = [
      "Nexperia seizure escalates as Beijing responds",
      "Fed holds rates steady while inflation cools",
      "Taiwan summit collapses after envoys walk out",
      "Ransomware crew breaches a hospital network",
      "OpenAI ships a smaller open weights model",
      "Wildfires close the coastal highway",
      "Fusion startup reports a net energy gain",
      "Antitrust suit filed against a cloud provider",
      "Sudan ceasefire talks resume in Geneva",
      "Bond yields spike on a surprise auction",
      "Gene therapy trial reverses hearing loss",
    ];
    let followed: FollowedStory[] = [];
    titles.forEach((t, i) => {
      followed = addFollow(followed, t, new Date(NOW.getTime() + i * 60_000));
    });
    expect(followed.length).toBe(MAX_FOLLOWED_STORIES);
    // The first three followed have been pushed out by the newest three.
    expect(followed.some((f) => f.title === titles[0])).toBe(false);
    expect(followed.some((f) => f.title === titles[titles.length - 1])).toBe(true);
  });

  it("stops following on request", () => {
    const followed = addFollow([], "Nexperia seizure escalates", NOW);
    expect(removeFollow(followed, "Nexperia seizure escalates")).toEqual([]);
  });

  it("stays alive while the story keeps appearing", () => {
    const followed = [follow("Nexperia seizure escalates as Beijing responds", 9)];
    const out = touchFollows(followed, ["Nexperia seizure escalates, Beijing responds"], NOW);
    expect(out.followed).toHaveLength(1);
    expect(out.lapsed).toEqual([]);
  });

  it("lapses when the story stops appearing, and says which", () => {
    const stale = follow("A story that ended a fortnight ago", 20);
    const out = touchFollows([stale], ["Something else entirely today"], NOW);
    expect(out.followed).toEqual([]);
    expect(out.lapsed).toHaveLength(1);
    expect(isLapsed(stale, NOW)).toBe(true);
  });

  it("validates whatever is in the settings blob", () => {
    expect(normalizeFollowedStories(null)).toEqual([]);
    expect(normalizeFollowedStories([{ title: "" }, 7, null])).toEqual([]);
    expect(normalizeFollowedStories([{ title: "Live story" }], NOW)).toHaveLength(1);
    // Already lapsed on read — a follow never comes back from the dead.
    expect(
      normalizeFollowedStories(
        [{ title: "Old", followedAt: daysAgo(40).toISOString(), lastSeenAt: daysAgo(40).toISOString() }],
        NOW,
      ),
    ).toEqual([]);
  });

  it("builds a matcher that costs nothing when nothing is followed", () => {
    expect(followMatcher([])("anything at all")).toBe(false);
    expect(followMatcher([follow("Nexperia seizure escalates")])("Nexperia seizure escalates")).toBe(
      true,
    );
  });
});

// ── Misfiles and desk suggestions ───────────────────────────────────────

describe("misfiles", () => {
  const misfile = (title: string, deskId = "geopolitics", days = 0) => ({
    title,
    deskId,
    at: daysAgo(days).toISOString(),
  });

  it("rules the rejected desk out for the same story tomorrow", () => {
    const misfiles = [misfile("Singapore tightens chip export rules aimed at Beijing")];
    expect(
      isRuledOut("Singapore tightens chip export rules further", "geopolitics", misfiles),
    ).toBe(true);
    // …and only that desk.
    expect(isRuledOut("Singapore tightens chip export rules further", "markets", misfiles)).toBe(
      false,
    );
  });

  it("does not rule a desk out on one word in common", () => {
    const misfiles = [misfile("Singapore tightens chip export rules")];
    expect(isRuledOut("Beijing tightens nothing whatsoever", "geopolitics", misfiles)).toBe(false);
  });

  it("expires and bounds what it stores", () => {
    expect(normalizeMisfiles([misfile("Old one", "ai", 200)], NOW)).toEqual([]);
    expect(normalizeMisfiles("nope")).toEqual([]);
    expect(normalizeMisfiles([{ title: "x" }, { deskId: "ai" }])).toEqual([]);
    const many = Array.from({ length: 90 }, (_, i) => misfile(`Story ${i}`, "ai"));
    expect(normalizeMisfiles(many, NOW).length).toBeLessThanOrEqual(60);
  });
});

describe("suggestDesks", () => {
  it("names the desk a run of corrections was describing", () => {
    const misfiles = [
      "Singapore tightens its chip export rules",
      "Singapore budget raises healthcare spending",
      "Singapore and Malaysia settle a water dispute",
      "Singapore central bank holds policy steady",
    ].map((title) => ({ title, deskId: "geopolitics", at: NOW.toISOString() }));
    const [top] = suggestDesks({ misfiles, desks: resolveDesks() });
    expect(top.label).toBe("Singapore");
    expect(top.keywords).toEqual(["singapore"]);
    expect(top.reason).toContain("wrongly filed");
    expect(top.id).toBe("custom:singapore");
  });

  it("notices what you keep saving", () => {
    const engagedTitles = [
      "Nintendo delays its next console",
      "Nintendo posts record software sales",
      "Nintendo sues a hardware modder",
      "Nintendo opens a second theme park",
      "Nintendo hires a new studio head",
      "Nintendo revives a dormant franchise",
    ];
    const [top] = suggestDesks({ engagedTitles, desks: resolveDesks() });
    expect(top.label).toBe("Nintendo");
    expect(top.reason).toContain("saved or read");
  });

  it("never suggests a desk the reader already has", () => {
    const engagedTitles = [
      "Singapore tightens its chip export rules",
      "Singapore budget raises healthcare spending",
      "Singapore and Malaysia settle a water dispute",
      "Singapore central bank holds policy steady",
      "Singapore port throughput hits a record",
      "Singapore courts rule on a data case",
    ];
    const desks = resolveDesks([
      { id: "custom:sg", label: "Singapore", desk: "Singapore", keywords: ["singapore"] },
    ]);
    expect(suggestDesks({ engagedTitles, desks })).toEqual([]);
  });

  it("never suggests something a built-in desk already covers", () => {
    const engagedTitles = Array.from({ length: 20 }, (_, i) => `Ransomware crew strikes again ${i}`);
    expect(
      suggestDesks({ engagedTitles, desks: resolveDesks() }).some((s) =>
        s.label.toLowerCase().startsWith("ransomware"),
      ),
    ).toBe(false);
  });

  it("stays quiet until there is a pattern", () => {
    expect(suggestDesks({ engagedTitles: ["Singapore does a thing"] })).toEqual([]);
    expect(suggestDesks({})).toEqual([]);
  });

  it("weighs a correction well above a save", () => {
    const suggestions = suggestDesks({
      engagedTitles: [
        "Nintendo delays its next console",
        "Nintendo posts record software sales",
        "Nintendo sues a hardware modder",
        "Nintendo opens a second theme park",
        "Nintendo hires a new studio head",
        "Nintendo revives a dormant franchise",
      ],
      misfiles: [
        "Singapore tightens its chip export rules",
        "Singapore budget raises healthcare spending",
        "Singapore central bank holds policy steady",
      ].map((title) => ({ title, deskId: "geopolitics", at: NOW.toISOString() })),
      desks: resolveDesks(),
      limit: 2,
    });
    expect(suggestions[0].label).toBe("Singapore");
  });

  it("never proposes a desk named after ordinary news vocabulary", () => {
    // The first version of this cheerfully proposed a desk called "Number".
    const engagedTitles = Array.from(
      { length: 12 },
      (_, i) => `The latest update on this story, report number ${i}`,
    );
    expect(suggestDesks({ engagedTitles, desks: resolveDesks() })).toEqual([]);
  });
});

// ── Citation verification ───────────────────────────────────────────────

describe("citation scope", () => {
  it("finds every plain ref and ignores external ones", () => {
    expect(citedRefsIn("Something [3] and [7], plus [E2] and [3] again.")).toEqual([3, 7]);
  });

  it("catches a number the section was never given", () => {
    // The dangerous case: [9] resolves against the shared source map to a real
    // article this section never read, so nothing about it looks broken.
    expect(outOfScopeRefs("A claim [3] and another [9].", [1, 3, 5])).toEqual([9]);
    expect(outOfScopeRefs("A claim [3].", [1, 3, 5])).toEqual([]);
  });

  it("says nothing when there is no scope to check against", () => {
    expect(outOfScopeRefs("A claim [3].", [])).toEqual([]);
  });
});

describe("parseVerification", () => {
  const section = "The Fed held rates steady at 4.25% [3]. Markets rallied afterwards [7].";

  it("reports a claim that was really made", () => {
    const raw = '{"unsupported":[{"ref":3,"claim":"held rates steady at 4.25%"}]}';
    expect(parseVerification(raw, section)).toEqual([
      { ref: 3, claim: "held rates steady at 4.25%" },
    ]);
  });

  it("drops a finding the section never said", () => {
    // The verifier is a model too: a hallucinated accusation under a correct
    // section would do more damage than the thing it guards against.
    const raw = '{"unsupported":[{"ref":3,"claim":"the Fed cut rates to zero"}]}';
    expect(parseVerification(raw, section)).toEqual([]);
  });

  it("drops a finding against a ref the section never cited", () => {
    const raw = '{"unsupported":[{"ref":9,"claim":"Markets rallied afterwards"}]}';
    expect(parseVerification(raw, section)).toEqual([]);
  });

  it("survives anything that is not the expected JSON", () => {
    expect(parseVerification("", section)).toEqual([]);
    expect(parseVerification("Sure! Here you go: not json", section)).toEqual([]);
    expect(parseVerification('{"unsupported":"nope"}', section)).toEqual([]);
    expect(parseVerification('{"unsupported":[{"ref":"3"}]}', section)).toEqual([]);
  });

  it("reads a clean answer as clean", () => {
    expect(parseVerification('{"unsupported":[]}', section)).toEqual([]);
    expect(parseVerification('Here is the result:\n{"unsupported":[]}\nDone.', section)).toEqual([]);
  });

  it("caps what one section can report", () => {
    const long = Array.from({ length: 9 }, (_, i) => `Claim number ${i} is stated here [3].`).join(" ");
    const raw = JSON.stringify({
      unsupported: Array.from({ length: 9 }, (_, i) => ({
        ref: 3,
        claim: `Claim number ${i} is stated here`,
      })),
    });
    expect(parseVerification(raw, long)).toHaveLength(MAX_REPORTED_CLAIMS);
  });
});

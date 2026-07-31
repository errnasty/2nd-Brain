import { describe, expect, it } from "vitest";
import {
  CORROBORATION_SATURATION,
  MAX_STORY_AGE_HOURS,
  VELOCITY_CEILING,
  VELOCITY_FLOOR,
  corroborationScore,
  externalHeat,
  normalizeVolume,
  personalRelevance,
  recencyDecay,
  scoreCluster,
  velocityMultiplier,
} from "./score";

const NOW = new Date("2026-07-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("corroborationScore", () => {
  it("rises with distinct feeds and saturates at the cap", () => {
    expect(corroborationScore(1)).toBeLessThan(corroborationScore(2));
    expect(corroborationScore(2)).toBeLessThan(corroborationScore(5));
    expect(corroborationScore(CORROBORATION_SATURATION)).toBe(1);
    expect(corroborationScore(50)).toBe(1);
  });

  it("is superlinear — the 1→2 step is the biggest one", () => {
    const step12 = corroborationScore(2) - corroborationScore(1);
    const step56 = corroborationScore(6) - corroborationScore(5);
    expect(step12 / corroborationScore(1)).toBeGreaterThan(step56 / corroborationScore(5));
  });

  it("scores nothing for zero sources", () => {
    expect(corroborationScore(0)).toBe(0);
    expect(corroborationScore(-3)).toBe(0);
  });
});

describe("velocityMultiplier", () => {
  it("stays inside its declared range", () => {
    for (const [feeds, age] of [[0, 0], [1, 100], [50, 0.001], [6, 1]] as const) {
      const v = velocityMultiplier(feeds, age);
      expect(v).toBeGreaterThanOrEqual(VELOCITY_FLOOR);
      expect(v).toBeLessThanOrEqual(VELOCITY_CEILING);
    }
  });

  it("rates a fast burst above a slow burn with the same source count", () => {
    expect(velocityMultiplier(6, 2)).toBeGreaterThan(velocityMultiplier(6, 96));
  });

  // The age floor is what stops a story whose first two tellings land in the
  // same minute from reporting an infinite rate and outranking everything.
  it("does not blow up when every telling arrives at once", () => {
    expect(Number.isFinite(velocityMultiplier(5, 0))).toBe(true);
    expect(velocityMultiplier(5, 0)).toBeLessThanOrEqual(VELOCITY_CEILING);
  });
});

describe("recencyDecay", () => {
  it("halves on the half-life", () => {
    expect(recencyDecay(0)).toBe(1);
    expect(recencyDecay(8)).toBeCloseTo(0.5, 5);
    expect(recencyDecay(16)).toBeCloseTo(0.25, 5);
  });
});

describe("scoreCluster", () => {
  const base = {
    distinctFeeds: 5,
    firstSeen: hoursAgo(4),
    lastSeen: hoursAgo(1),
  };

  it("ranks a widely-corroborated story above a single-source one", () => {
    const many = scoreCluster(base, NOW).score;
    const one = scoreCluster({ ...base, distinctFeeds: 1 }, NOW).score;
    expect(many).toBeGreaterThan(one);
  });

  it("ranks today's story above an equally-covered older one", () => {
    const fresh = scoreCluster(base, NOW).score;
    const stale = scoreCluster(
      { ...base, firstSeen: hoursAgo(40), lastSeen: hoursAgo(36) },
      NOW,
    ).score;
    expect(fresh).toBeGreaterThan(stale);
  });

  it("zeroes anything past the max age, however well covered", () => {
    const ancient = scoreCluster(
      {
        distinctFeeds: 8,
        firstSeen: hoursAgo(MAX_STORY_AGE_HOURS + 20),
        lastSeen: hoursAgo(MAX_STORY_AGE_HOURS + 1),
        externalVolume: 1,
        personalScore: 1,
      },
      NOW,
    );
    expect(ancient.score).toBe(0);
  });

  it("lets external heat and personal relevance lift a thin story", () => {
    const bare = scoreCluster({ ...base, distinctFeeds: 2 }, NOW).score;
    const hot = scoreCluster(
      { ...base, distinctFeeds: 2, externalVolume: 1, personalScore: 1 },
      NOW,
    ).score;
    expect(hot).toBeGreaterThan(bare);
  });

  it("boosts a story on a desk the user follows", () => {
    const off = scoreCluster(base, NOW).score;
    const on = scoreCluster({ ...base, onFollowedDesk: true }, NOW).score;
    expect(on).toBeGreaterThan(off);
  });

  it("always returns a score in 0–1", () => {
    const maxed = scoreCluster(
      {
        distinctFeeds: 100,
        firstSeen: hoursAgo(1),
        lastSeen: NOW,
        externalVolume: 1,
        personalScore: 1,
        onFollowedDesk: true,
      },
      NOW,
    );
    expect(maxed.score).toBeGreaterThan(0);
    expect(maxed.score).toBeLessThanOrEqual(1);
  });
});

describe("normalizeVolume", () => {
  it("squashes heavy tails into 0–1", () => {
    expect(normalizeVolume(0, 500)).toBe(0);
    expect(normalizeVolume(500, 500)).toBeCloseTo(1, 5);
    expect(normalizeVolume(5000, 500)).toBe(1);
  });

  it("gives 10→100 more room than 1000→1090", () => {
    const low = normalizeVolume(100, 2000) - normalizeVolume(10, 2000);
    const high = normalizeVolume(1090, 2000) - normalizeVolume(1000, 2000);
    expect(low).toBeGreaterThan(high);
  });
});

describe("externalHeat", () => {
  it("is zero with no matches and capped at one", () => {
    expect(externalHeat([])).toBe(0);
    expect(
      externalHeat([
        { term: "a", weight: 1 },
        { term: "b", weight: 1 },
        { term: "c", weight: 1 },
      ]),
    ).toBeLessThanOrEqual(1);
  });

  // Keyword stuffing must not beat matching the one term that matters.
  it("prefers one strong match to several weak ones", () => {
    const strong = externalHeat([{ term: "big", weight: 0.9 }]);
    const stuffed = externalHeat(
      Array.from({ length: 6 }, (_, i) => ({ term: `w${i}`, weight: 0.2 })),
    );
    expect(strong).toBeGreaterThan(stuffed);
  });
});

describe("personalRelevance", () => {
  // Unrelated text embeddings still cosine around 0.3; without the rebase every
  // story would arrive carrying free "relevance".
  it("ignores baseline similarity between unrelated text", () => {
    expect(personalRelevance({ similarity: 0.3 })).toBe(0);
    expect(personalRelevance({ similarity: 0.9 })).toBeGreaterThan(0);
  });

  it("adds for followed desks and starred members, capped at one", () => {
    expect(personalRelevance({ onFollowedDesk: true })).toBeGreaterThan(0);
    expect(
      personalRelevance({ similarity: 1, onFollowedDesk: true, starredInCluster: true }),
    ).toBeLessThanOrEqual(1);
  });
});

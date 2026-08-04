import { describe, expect, it } from "vitest";
import {
  MEMORY_MAX_AGE_DAYS,
  MEMORY_MAX_STORIES,
  citedRefs,
  continuingSince,
  coveredTitles,
  matchRemembered,
  mergeStoryMemory,
  parseStoryMemory,
  type RememberedStory,
} from "./story-memory";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-04T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function memory(): RememberedStory[] {
  return [
    {
      title: "Fed holds rates steady as inflation cools",
      firstBriefedAt: daysAgo(3),
      lastBriefedAt: daysAgo(1),
    },
    {
      title: "OpenAI ships a smaller open weights model",
      firstBriefedAt: daysAgo(1),
      lastBriefedAt: daysAgo(1),
    },
  ];
}

describe("parseStoryMemory", () => {
  it("accepts a well-formed memory and rejects everything else", () => {
    expect(parseStoryMemory(memory())).toHaveLength(2);
    expect(parseStoryMemory(null)).toEqual([]);
    expect(parseStoryMemory("[]")).toEqual([]);
    expect(parseStoryMemory([{ title: "x" }, null, 7])).toEqual([]);
  });
});

describe("matchRemembered", () => {
  it("recognises a story whose framing has drifted overnight", () => {
    const hit = matchRemembered("Fed holds rates steady as inflation cools further", memory());
    expect(hit?.title).toContain("Fed holds rates steady");
  });

  it("does not match an unrelated headline", () => {
    expect(matchRemembered("A recipe for sourdough bread at home", memory())).toBeNull();
  });

  it("does not match on a couple of shared common words", () => {
    expect(matchRemembered("The model of a modern open society", memory())).toBeNull();
  });

  it("has nothing to match against on an empty memory", () => {
    expect(matchRemembered("Fed holds rates steady as inflation cools", [])).toBeNull();
  });
});

describe("continuingSince", () => {
  it("puts the gap in the words a person would use", () => {
    expect(continuingSince(memory()[0], NOW)).toBe("3 days ago");
    expect(continuingSince(memory()[1], NOW)).toBe("yesterday");
  });

  it("claims no continuity with the brief being written right now", () => {
    const fresh: RememberedStory = {
      title: "x",
      firstBriefedAt: NOW.toISOString(),
      lastBriefedAt: NOW.toISOString(),
    };
    expect(continuingSince(fresh, NOW)).toBeNull();
  });

  it("survives a corrupt timestamp", () => {
    expect(
      continuingSince({ title: "x", firstBriefedAt: "nonsense", lastBriefedAt: "nonsense" }, NOW),
    ).toBeNull();
  });
});

describe("mergeStoryMemory", () => {
  it("keeps the date a continuing story was FIRST briefed", () => {
    const merged = mergeStoryMemory(memory(), ["Fed holds rates steady as inflation cools"], NOW);
    const fed = merged.find((s) => s.title.startsWith("Fed"));
    expect(fed?.firstBriefedAt).toBe(daysAgo(3));
    expect(fed?.lastBriefedAt).toBe(NOW.toISOString());
  });

  it("adds a story it has never seen", () => {
    const merged = mergeStoryMemory(memory(), ["Undersea cable cut in the Baltic"], NOW);
    expect(merged).toHaveLength(3);
    expect(merged[0].firstBriefedAt).toBe(NOW.toISOString());
  });

  it("forgets stories that have gone quiet", () => {
    const stale = [
      { title: "Old news nobody followed up", firstBriefedAt: daysAgo(9), lastBriefedAt: daysAgo(8) },
      ...memory(),
    ];
    const merged = mergeStoryMemory(stale, [], NOW);
    expect(merged.map((s) => s.title)).not.toContain("Old news nobody followed up");
    expect(merged).toHaveLength(2);
  });

  it("keeps a story right up to the age limit", () => {
    const edge = [
      {
        title: "Just inside the window",
        firstBriefedAt: daysAgo(MEMORY_MAX_AGE_DAYS),
        lastBriefedAt: daysAgo(MEMORY_MAX_AGE_DAYS - 0.1),
      },
    ];
    expect(mergeStoryMemory(edge, [], NOW)).toHaveLength(1);
  });

  it("caps the memory, dropping the least recently briefed", () => {
    const many = Array.from({ length: MEMORY_MAX_STORIES + 20 }, (_, i) => ({
      title: `Distinct story number ${i} about something`,
      firstBriefedAt: daysAgo(1),
      // Older as i grows, so the tail is what should be lost.
      lastBriefedAt: new Date(NOW.getTime() - i * 1000).toISOString(),
    }));
    const merged = mergeStoryMemory(many, [], NOW);
    expect(merged).toHaveLength(MEMORY_MAX_STORIES);
    expect(merged.map((s) => s.title)).toContain("Distinct story number 0 about something");
    expect(merged.map((s) => s.title)).not.toContain(
      `Distinct story number ${MEMORY_MAX_STORIES + 19} about something`,
    );
  });

  it("ignores blank titles rather than remembering an empty story", () => {
    expect(mergeStoryMemory([], ["", "   "], NOW)).toEqual([]);
  });
});

describe("citedRefs", () => {
  it("reads the numbers the brief actually used, deduplicated and sorted", () => {
    expect(citedRefs("**Claim** [3]. More on it [12], and again [3].")).toEqual([3, 12]);
  });

  it("ignores the external section's own numbering", () => {
    // [E2] is not an article ref — it points into a separate namespace.
    expect(citedRefs("A blind spot [E2] and a real one [4].")).toEqual([4]);
  });

  it("finds nothing in a brief that cited nothing", () => {
    expect(citedRefs("Nothing obviously skippable today.")).toEqual([]);
  });
});

describe("coveredTitles", () => {
  const sources = [
    { n: 1, title: "First story" },
    { n: 2, title: "Second story" },
    { n: 3, title: "Third story" },
  ];

  it("remembers what the brief wrote about, not what it was offered", () => {
    expect(coveredTitles("Only this one mattered [2].", sources)).toEqual(["Second story"]);
  });

  it("drops a citation that resolves to nothing", () => {
    expect(coveredTitles("Out of range [99].", sources)).toEqual([]);
  });
});

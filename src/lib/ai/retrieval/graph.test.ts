import { describe, expect, it } from "vitest";
import { admit, finalScore, describePath, type GraphPath } from "./graph";

describe("admit — two-threshold admission", () => {
  it("admits a strong edge on its own", () => {
    expect(admit(0.42, 1, 1)).toBe(true);
  });

  it("rejects a weak edge no matter how corroborated", () => {
    // Below the floor is noise: a busy folder reached at two hops does not
    // become evidence just because two seeds touched it.
    expect(admit(0.05, 3, 3)).toBe(false);
  });

  it("rejects an uncertain edge with only one reason", () => {
    expect(admit(0.2, 1, 1)).toBe(false);
  });

  it("admits an uncertain edge corroborated by a second edge kind", () => {
    expect(admit(0.2, 2, 1)).toBe(true);
  });

  it("admits an uncertain edge corroborated by a second seed", () => {
    expect(admit(0.2, 1, 2)).toBe(true);
  });

  it("treats the thresholds as inclusive/exclusive consistently", () => {
    expect(admit(0.3, 1, 1)).toBe(true); // exactly ADMIT
    expect(admit(0.12, 1, 1)).toBe(false); // exactly REJECT, uncorroborated
    expect(admit(0.12, 2, 1)).toBe(true); // exactly REJECT, corroborated
  });
});

describe("finalScore — corroboration bonus", () => {
  it("leaves a single-path score untouched", () => {
    expect(finalScore({ best: 0.4, edgeKinds: new Set(["tag"]), seeds: new Set(["a"]) })).toBeCloseTo(0.4);
  });

  it("rewards an item reached two independent ways", () => {
    const one = finalScore({ best: 0.4, edgeKinds: new Set(["tag"]), seeds: new Set(["a"]) });
    const two = finalScore({
      best: 0.4,
      edgeKinds: new Set(["tag", "wikilink"]),
      seeds: new Set(["a", "b"]),
    });
    expect(two).toBeGreaterThan(one);
  });

  it("caps the bonus so a hub item cannot run away with it", () => {
    const many = finalScore({
      best: 0.4,
      edgeKinds: new Set(["tag", "wikilink", "folder"]),
      seeds: new Set(["a", "b", "c", "d", "e", "f"]),
    });
    expect(many).toBeCloseTo(0.4 * 1.45);
  });
});

describe("describePath", () => {
  const titles = new Map([["seed-1", "Info Ops Notes"]]);
  const titleOf = (id: string) => titles.get(id);

  it("names the item a wikilink came from", () => {
    const paths: GraphPath[] = [{ kind: "wikilink", fromItemId: "seed-1" }];
    expect(describePath(paths, titleOf)).toBe('linked from "Info Ops Notes"');
  });

  it("names the shared tag", () => {
    const paths: GraphPath[] = [{ kind: "tag", fromItemId: "seed-1", label: "geopolitics" }];
    expect(describePath(paths, titleOf)).toBe('shares tag "geopolitics"');
  });

  it("falls back when the seed title is unknown", () => {
    const paths: GraphPath[] = [{ kind: "wikilink", fromItemId: "gone" }];
    expect(describePath(paths, titleOf)).toBe("linked from a matched item");
  });

  it("joins at most two reasons", () => {
    const paths: GraphPath[] = [
      { kind: "wikilink", fromItemId: "seed-1" },
      { kind: "tag", fromItemId: "seed-1", label: "ops" },
      { kind: "folder", fromItemId: "seed-1", label: "Archive" },
    ];
    const out = describePath(paths, titleOf);
    expect(out).toBe('linked from "Info Ops Notes"; shares tag "ops"');
    expect(out).not.toContain("Archive");
  });
});

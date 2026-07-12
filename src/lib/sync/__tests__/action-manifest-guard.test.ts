import { describe, expect, it } from "vitest";
import {
  actionIdsFromManifest,
  assertActionManifestsConsistent,
} from "../../../../scripts/action-manifest-guard.mjs";

// Minimal shape mirroring Next.js server-reference-manifest.json:
// { node: { <40+ hex id>: {...} }, edge: { <id>: {...} } }
function manifest(ids: string[]) {
  const groups: Record<string, unknown> = {};
  for (const id of ids) groups[id] = { workers: {}, layer: {} };
  return { node: groups };
}

describe("actionIdsFromManifest", () => {
  it("collects 40+ hex action IDs from the node group", () => {
    const m = manifest(["00f35b911162f1faabc25b5a23bb075dbb28a9cefc", "abcdef0123456789".repeat(3)]);
    const ids = actionIdsFromManifest(m);
    expect(ids.size).toBe(2);
    expect(ids.has("00f35b911162f1faabc25b5a23bb075dbb28a9cefc")).toBe(true);
  });

  it("reads from the edge group when node is absent", () => {
    const m = { edge: { ["a".repeat(40)]: {} } };
    expect(actionIdsFromManifest(m).size).toBe(1);
  });

  it("ignores non-action keys and malformed input", () => {
    const m = { node: { workers: {}, version: "1", "12345": {} } };
    expect(actionIdsFromManifest(m).size).toBe(0);
    expect(actionIdsFromManifest(null).size).toBe(0);
    expect(actionIdsFromManifest({}).size).toBe(0);
  });
});

describe("assertActionManifestsConsistent (Server Action mismatch guard)", () => {
  it("passes when the server and bundled standalone manifest agree", () => {
    const ids = ["00f35b911162f1faabc25b5a23bb075dbb28a9cefc", "a".repeat(40), "b".repeat(40)];
    expect(() =>
      assertActionManifestsConsistent(manifest(ids), manifest([...ids].reverse())),
    ).not.toThrow();
  });

  it("throws when an action exists on the server but not in the bundled standalone", () => {
    // This is exactly the stale-build scenario that produced
    // "Server Action '<hash>' was not found on the server" at runtime.
    const server = manifest(["00f35b911162f1faabc25b5a23bb075dbb28a9cefc", "a".repeat(40)]);
    const standalone = manifest(["a".repeat(40)]);
    expect(() => assertActionManifestsConsistent(server, standalone)).toThrow(
      /Server Action manifest mismatch/,
    );
  });

  it("throws when an action exists in the standalone but not on the server", () => {
    const server = manifest(["a".repeat(40)]);
    const standalone = manifest(["00f35b911162f1faabc25b5a23bb075dbb28a9cefc", "a".repeat(40)]);
    expect(() => assertActionManifestsConsistent(server, standalone)).toThrow(
      /Server Action manifest mismatch/,
    );
  });
});

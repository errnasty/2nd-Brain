import { describe, expect, it } from "vitest";
import {
  canonicalizeLinks,
  findDuplicate,
  initialism,
  significantTokens,
} from "./concept-dedupe";

const existing = [
  { slug: "transport-layer-security", name: "Transport Layer Security" },
  { slug: "dns-spoofing", name: "DNS spoofing" },
  { slug: "congestion-control", name: "Congestion control" },
];

describe("significantTokens", () => {
  // "TCP" and "TCP protocol" are the same thing; the generic noun does no work.
  it("drops generic nouns models tack on", () => {
    expect(significantTokens("TCP protocol")).toEqual(["tcp"]);
    expect(significantTokens("Sliding window technique")).toEqual(["sliding", "window"]);
  });
});

describe("initialism", () => {
  it("builds one from a multi-word name", () => {
    expect(initialism("Transport Layer Security")).toBe("tls");
  });

  it("returns null for a single word", () => {
    expect(initialism("Kerberos")).toBeNull();
  });
});

describe("findDuplicate", () => {
  it("matches an identical slug", () => {
    expect(findDuplicate("dns spoofing", existing)?.slug).toBe("dns-spoofing");
  });

  // The case that actually fragments a graph.
  it("matches an abbreviation against its expansion", () => {
    expect(findDuplicate("TLS", existing)?.slug).toBe("transport-layer-security");
  });

  it("matches through a generic trailing noun", () => {
    expect(findDuplicate("Congestion control algorithm", existing)?.slug).toBe(
      "congestion-control",
    );
  });

  // Merging two different concepts loses one permanently; failing to merge
  // costs one extra card. The threshold leans away from merging.
  it("keeps genuinely different concepts apart", () => {
    expect(findDuplicate("Flow control", existing)).toBeNull();
    expect(findDuplicate("DNS over HTTPS", existing)).toBeNull();
    expect(findDuplicate("Kerberos", existing)).toBeNull();
  });

  it("returns null for unusable names", () => {
    expect(findDuplicate("", existing)).toBeNull();
    expect(findDuplicate("!!", existing)).toBeNull();
  });

  it("handles an empty graph", () => {
    expect(findDuplicate("Kerberos", [])).toBeNull();
  });
});

describe("canonicalizeLinks", () => {
  it("points links at concepts that already exist", () => {
    const out = canonicalizeLinks([{ name: "TLS" }, { name: "Kerberos" }], existing);
    expect(out[0]).toEqual({ name: "Transport Layer Security", slug: "transport-layer-security" });
    expect(out[1]).toEqual({ name: "Kerberos", slug: "kerberos" });
  });

  // Two links collapsing onto the same node would render as a duplicate chip.
  it("de-duplicates links that collapse onto one concept", () => {
    const out = canonicalizeLinks([{ name: "TLS" }, { name: "Transport Layer Security" }], existing);
    expect(out).toHaveLength(1);
  });

  it("drops unusable link names", () => {
    expect(canonicalizeLinks([{ name: "!" }, { name: "a" }], existing)).toEqual([]);
  });
});

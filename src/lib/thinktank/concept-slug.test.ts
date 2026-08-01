import { describe, expect, it } from "vitest";
import { conceptName, conceptSlug, isValidConceptName, stripExpansion } from "./concept-slug";

describe("conceptSlug", () => {
  it("is stable across case and punctuation", () => {
    expect(conceptSlug("DNS Spoofing")).toBe(conceptSlug("dns spoofing"));
    expect(conceptSlug("DNS-Spoofing!")).toBe(conceptSlug("DNS spoofing"));
  });

  // Leading articles are the single most common way the same idea arrives
  // twice, and each duplicate is a card paid for twice and a split graph.
  it("ignores leading articles", () => {
    expect(conceptSlug("The CAP theorem")).toBe(conceptSlug("CAP theorem"));
    expect(conceptSlug("A sliding window")).toBe(conceptSlug("sliding window"));
  });

  it("drops trailing qualifiers", () => {
    expect(conceptSlug("DNS spoofing (attack)")).toBe(conceptSlug("DNS spoofing"));
    expect(conceptSlug("TLS (Transport Layer Security)")).toBe(conceptSlug("TLS"));
  });

  it("keeps genuinely different concepts apart", () => {
    expect(conceptSlug("TCP")).not.toBe(conceptSlug("UDP"));
    expect(conceptSlug("congestion control")).not.toBe(conceptSlug("flow control"));
  });

  it("clamps runaway names", () => {
    expect(conceptSlug("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("produces no leading or trailing separators", () => {
    expect(conceptSlug("  ...Kerberos!!  ")).toBe("kerberos");
  });
});

describe("stripExpansion", () => {
  it("removes only a trailing parenthetical", () => {
    expect(stripExpansion("MITRE ATT&CK (framework)")).toBe("MITRE ATT&CK");
    expect(stripExpansion("RSA (Rivest) and friends")).toBe("RSA (Rivest) and friends");
  });
});

describe("isValidConceptName", () => {
  it("rejects things too short or empty to be a concept", () => {
    expect(isValidConceptName("")).toBe(false);
    expect(isValidConceptName("a")).toBe(false);
    expect(isValidConceptName("!!")).toBe(false);
    expect(isValidConceptName("42")).toBe(false);
  });

  it("accepts real concept names", () => {
    expect(isValidConceptName("Kerberos")).toBe(true);
    expect(isValidConceptName("YARA rules")).toBe(true);
  });
});

describe("conceptName", () => {
  it("collapses whitespace and clamps length", () => {
    expect(conceptName("  Sliding   Window  ")).toBe("Sliding Window");
    expect(conceptName("y".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

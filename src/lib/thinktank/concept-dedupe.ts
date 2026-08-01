/**
 * Catching two names for one idea before they become two cards.
 *
 * `conceptSlug` handles the mechanical cases — case, punctuation, "the",
 * trailing parentheticals. It cannot handle the ones that actually hurt:
 *
 *     TLS            /  Transport Layer Security
 *     DNS spoofing   /  DNS cache poisoning
 *     Sliding window /  Sliding-window protocol
 *
 * Left alone these become separate nodes, each generated and paid for
 * separately, each with its own partial set of links. The graph splits, and it
 * splits *more* the more the feature is used — which is the worst shape a bug
 * can have.
 *
 * This module is the string half of the guard: cheap, deterministic, no
 * embedding call. It runs over the names the model just proposed against the
 * names the user already has.
 *
 * Pure — no db, no network.
 */

import { conceptSlug, isValidConceptName } from "./concept-slug";

/** Words that carry no identifying weight when comparing two concept names. */
const NOISE = new Set([
  "a", "an", "the", "of", "for", "and", "or", "in", "on", "to", "with",
  // Generic nouns models tack onto a concept name. "TCP" and "TCP protocol"
  // are the same thing; "protocol" is doing no work.
  "protocol", "attack", "technique", "method", "approach", "concept", "model",
  "system", "algorithm", "framework", "pattern", "principle", "theory", "rules",
  "rule", "based", "type", "types",
]);

/** Identifying tokens of a name, in a stable order. */
export function significantTokens(name: string): string[] {
  return conceptSlug(name)
    .split("-")
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

/**
 * An initialism built from a multi-word name: "transport layer security" → "tls".
 * Returns null when the name is too short to have one.
 */
export function initialism(name: string): string | null {
  const tokens = conceptSlug(name).split("-").filter((t) => t.length > 0 && !NOISE.has(t));
  if (tokens.length < 2) return null;
  return tokens.map((t) => t[0]).join("");
}

/** Jaccard overlap of two token sets. */
function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Token overlap above which two names are the same concept.
 *
 * High on purpose. The two failure directions are not symmetric: merging two
 * genuinely different concepts loses one of them permanently from the graph,
 * while failing to merge merely costs one extra card. When unsure, don't merge
 * — the embedding check is not available here and a string is thin evidence.
 */
export const MERGE_THRESHOLD = 0.8;

export type ExistingConcept = { slug: string; name: string };

/**
 * The existing concept a proposed name is really the same as, or null.
 *
 * Checks, in order of confidence: identical slug, one name being the other's
 * initialism, then heavy token overlap.
 */
export function findDuplicate(
  proposed: string,
  existing: ExistingConcept[],
): ExistingConcept | null {
  const slug = conceptSlug(proposed);
  if (!slug) return null;

  const exact = existing.find((e) => e.slug === slug);
  if (exact) return exact;

  const proposedInitials = initialism(proposed);
  const proposedTokens = significantTokens(proposed);

  for (const candidate of existing) {
    // "TLS" vs "Transport Layer Security", in either direction.
    const candidateInitials = initialism(candidate.name);
    if (proposedInitials && candidateInitials === proposedInitials) return candidate;
    if (proposedInitials && conceptSlug(candidate.name) === proposedInitials) return candidate;
    if (candidateInitials && slug === candidateInitials) return candidate;

    if (overlap(proposedTokens, significantTokens(candidate.name)) >= MERGE_THRESHOLD) {
      return candidate;
    }
  }

  return null;
}

/**
 * Rewrite a card's related links onto concepts that already exist where one is
 * clearly the same idea.
 *
 * This is where the guard pays off: the links are what the user taps, so
 * pointing them at existing nodes is what keeps the graph joined up rather than
 * growing a parallel copy of itself.
 */
export function canonicalizeLinks(
  links: { name: string }[],
  existing: ExistingConcept[],
): { name: string; slug: string }[] {
  const out: { name: string; slug: string }[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    // Validate before minting: an unusable link name would otherwise become a
    // junk node the moment someone taps it.
    if (!isValidConceptName(link.name)) continue;
    const dupe = findDuplicate(link.name, existing);
    const name = dupe ? dupe.name : link.name;
    const slug = dupe ? dupe.slug : conceptSlug(link.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug });
  }

  return out;
}

/**
 * Concept identity: turning a name into the key that decides whether we have
 * already written this card.
 *
 * This is the single most load-bearing piece of the Explore graph. The slug is
 * the cache key — `UNIQUE (user_id, slug)` — so it decides three things at
 * once: whether tapping a related concept costs an AI call or is free, whether
 * the graph stays connected, and whether the user ends up with three separate
 * cards for the same idea.
 *
 * Getting it wrong is expensive in a way that compounds: "TLS", "SSL/TLS" and
 * "Transport Layer Security" as three nodes means three generations paid for,
 * three partial link-neighbourhoods, and a graph that quietly fragments the
 * more it is used. Normalization here handles the mechanical cases; genuine
 * synonyms are caught separately by an embedding check before insert.
 *
 * Pure and client-safe — the reader builds hrefs from it.
 */

/**
 * Leading articles carry no meaning in a concept name and are the single most
 * common source of a duplicate ("The CAP theorem" vs "CAP theorem").
 */
const LEADING_NOISE = /^(the|a|an)\s+/i;

/**
 * Trailing qualifiers models like to append. Stripped so "DNS spoofing
 * (attack)" and "DNS spoofing" are one concept.
 */
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/;

/**
 * Expansions of an abbreviation, in either direction. Only the mechanical form
 * — "X (Y)" or "Y (X)" — is handled here; semantic synonyms are not a string
 * problem and are dealt with by similarity search.
 */
export function stripExpansion(raw: string): string {
  return raw.replace(TRAILING_PARENTHETICAL, "").trim();
}

/**
 * The cache key for a concept name.
 *
 * Deliberately aggressive: lowercased, punctuation collapsed, leading articles
 * and trailing parentheticals removed. Two names that differ only in these
 * ways are the same idea, and treating them as different is strictly worse
 * than the rare over-merge — an over-merge shows a correct card under a
 * slightly different name, an under-merge silently pays twice and splits the
 * graph.
 */
export function conceptSlug(name: string): string {
  const base = stripExpansion(name).replace(LEADING_NOISE, "");
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** A display name trimmed and clamped for storage. */
export function conceptName(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
}

/** Whether a name is usable as a concept at all. */
export function isValidConceptName(raw: string): boolean {
  const slug = conceptSlug(raw);
  // Two characters is not a concept, it's an abbreviation fragment or noise —
  // and a one-letter slug would collide with everything.
  return slug.length >= 3 && /[a-z]/.test(slug);
}

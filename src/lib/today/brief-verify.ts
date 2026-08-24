/**
 * Checking that the brief's citations mean what they say.
 *
 * ## The one rule a prompt can only ask nicely about
 *
 * Every section prompt ends with the same two constraints: cite only the
 * numbers you were given, and never state a fact the supplied text does not
 * support. They are the load-bearing ones — a brief whose `[3]` points at
 * something that does not say what the sentence claims is worse than no brief,
 * because it reads exactly like a correct one. And they are the two the prompt
 * has no way to enforce. Everything else in the brief is decided
 * deterministically; this was the last thing left purely to the model's
 * goodwill.
 *
 * ## Two checks, and only one of them costs anything
 *
 * **Scope** is free and exact. A section is handed a specific set of refs, so
 * any other number in its output is wrong by construction — either invented, or
 * borrowed from another section, in which case the client's shared source map
 * will happily resolve it to a real article that the section never read. That
 * second case is the dangerous one, because nothing about it looks broken.
 * Catching it needs no model and no network.
 *
 * **Support** — does the sentence follow from the cited text — genuinely needs
 * a reader. That runs on the lite tier, after the section is already on screen,
 * from its own endpoint, so it costs the reader no latency and a failure costs
 * nothing at all.
 *
 * ## What it does with what it finds
 *
 * Nothing loud. A clean section — which is the overwhelming majority — shows no
 * change whatsoever, which is what keeps this from being a feature anyone has
 * to remember. Only a section with something to answer for gets a quiet line,
 * and the line reports rather than accuses: the claim, and the fact that it
 * wasn't found in the source.
 *
 * The pure half lives here; the model call is in the route.
 */

/** Every `[n]` a section actually cited, in order of first appearance. */
export function citedRefsIn(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  // Plain numbers only. `[E1]`-style external refs live in their own namespace
  // and resolve to stories that were deliberately never fetched.
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Refs the section cited that it was never given.
 *
 * Exact, free, and the one check that catches the failure with no symptoms:
 * a number the client's source map resolves to a real article the section
 * never saw.
 */
export function outOfScopeRefs(text: string, allowed: number[]): number[] {
  if (allowed.length === 0) return [];
  const ok = new Set(allowed);
  return citedRefsIn(text).filter((n) => !ok.has(n));
}

/** One claim the sources do not appear to support. */
export type UnsupportedClaim = {
  /** The ref it was cited against. */
  ref: number;
  /** The claim, quoted from the section, short enough to show inline. */
  claim: string;
};

/** Ceiling on what one section is worth reporting. Past this it is not a
 *  finding, it is a broken generation, and the reader needs the short version. */
export const MAX_REPORTED_CLAIMS = 3;

/** Longest a quoted claim may be before it stops being a quote. */
const MAX_CLAIM_CHARS = 160;

/**
 * The verification prompt.
 *
 * Framed as an evidence check rather than a critique, and told explicitly to
 * return nothing when everything holds. A model asked to "review" prose will
 * always find something to say; a model asked "which of these sentences are
 * not supported by the text below" and given permission to answer "none" will
 * usually answer "none", which is both the truth and the outcome that keeps
 * this invisible.
 */
export const VERIFY_SYSTEM_PROMPT = `You are checking one section of a news brief against the source material it was written from. You are not editing it, rating it, or improving it.

- A claim is SUPPORTED if the cited article's text states it, or states something it follows from directly. Ordinary summarising, paraphrase and condensation are supported.
- A claim is UNSUPPORTED only if the cited text does not contain it at all — a figure that appears nowhere, a quote nobody said, an attribution to the wrong party, an event the text does not describe.
- Judge each claim ONLY against the article whose number it cites.
- Interpretation, framing, editorial emphasis and stated uncertainty are never unsupported. Neither is a claim you merely find unconvincing.
- Most sections have nothing wrong with them. Returning an empty list is the expected answer.

Reply with JSON only, no prose: {"unsupported":[{"ref":3,"claim":"the exact sentence or clause, copied"}]}
Return at most 3. If everything checks out, reply exactly: {"unsupported":[]}`;

/** The user turn: what was written, and what it was written from. */
export function verifyUserPrompt(sectionText: string, articleBlock: string): string {
  return `The section as written:\n\n${sectionText}\n\n---\n\nThe source articles it was given:\n\n${articleBlock}`;
}

type RawClaim = { ref?: unknown; claim?: unknown };

/**
 * Parse and sanity-check the verifier's reply.
 *
 * Everything is re-checked against the section: a claim is only reported if its
 * ref was really cited and its text really appears in what was written. The
 * verifier is another model, so a hallucinated finding is exactly as likely as
 * the hallucination it is looking for — and a false accusation printed under a
 * correct section would do more damage than the thing it is guarding against.
 */
export function parseVerification(raw: string, sectionText: string): UnsupportedClaim[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: { unsupported?: RawClaim[] };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as { unsupported?: RawClaim[] };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.unsupported)) return [];

  const cited = new Set(citedRefsIn(sectionText));
  const haystack = normalizeForMatch(sectionText);
  const out: UnsupportedClaim[] = [];
  for (const c of parsed.unsupported) {
    if (typeof c?.claim !== "string" || typeof c?.ref !== "number") continue;
    const claim = c.claim.trim().slice(0, MAX_CLAIM_CHARS);
    if (claim.length < 12) continue;
    if (!cited.has(c.ref)) continue;
    if (!haystack.includes(normalizeForMatch(claim))) continue;
    out.push({ ref: c.ref, claim });
    if (out.length >= MAX_REPORTED_CLAIMS) break;
  }
  return out;
}

/** Loose containment: markdown emphasis and whitespace must not defeat the check. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

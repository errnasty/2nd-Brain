/**
 * Turning headlines into trending terms, and matching those terms back against
 * a user's articles.
 *
 * The public signals hand back headlines ("Fed holds rates steady as inflation
 * cools"). What the scorer needs is the handful of phrases that make a story
 * identifiable — "fed", "inflation", "rates" — so an article in the user's own
 * feeds can be recognised as being about the same thing.
 *
 * The extraction is deliberately statistical rather than model-based, for the
 * same reasons the desk classifier in `src/lib/today/topics.ts` is keyword
 * based: it costs nothing, it's deterministic (so the same signal always
 * produces the same terms), and it can't eat into the cron's time budget.
 *
 * Pure — no db, no network, no clock.
 */

/**
 * Words that appear in headlines constantly and identify nothing. Broader than
 * the clustering stop list: that one only needs to not wreck title overlap,
 * this one has to avoid boosting every article in the database because the
 * word "says" trended.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "it", "its", "that", "this", "these", "those", "how", "why", "what", "when",
  "where", "who", "which", "after", "before", "over", "under", "into", "amid",
  "says", "say", "said", "new", "news", "latest", "update", "updates", "report",
  "reports", "reveals", "could", "would", "should", "may", "might", "will",
  "can", "has", "have", "had", "not", "no", "more", "most", "than", "then",
  "now", "top", "best", "worst", "first", "last", "here", "you", "your", "we",
  "our", "about", "against", "between", "during", "out", "up", "down",
  "off", "per", "via", "amp", "one", "two", "three", "million", "billion",
  "year", "years", "day", "days", "week", "weeks", "month", "months", "time",
  "people", "world", "us", "u", "s",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A term must be this long to be usable. Two characters matches far too much
 * ("ai" is handled by the desk classifier, which has the context to do it
 * safely; a raw trending boost on it would light up half the database).
 */
const MIN_TERM_LENGTH = 3;

/** Candidate phrases from one headline: single words plus adjacent bigrams. */
export function extractPhrases(title: string): string[] {
  const words = normalizeTerm(title)
    .split(" ")
    .filter((w) => w.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const phrases: string[] = [...words];
  // Bigrams carry most of the identifying power ("interest rates", "supreme
  // court"), and they're specific enough that matching one is real evidence.
  for (let i = 0; i < words.length - 1; i += 1) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}

export type WeightedTerm = { term: string; weight: number };

/**
 * Rank the terms across a batch of headlines, weighted 0–1.
 *
 * A term's weight combines how many headlines it appears in with the prior
 * importance of those headlines (their position in a ranked list, their upvote
 * count — whatever the source measures). Bigrams get a boost because matching
 * "interest rates" says far more than matching "rates".
 *
 * Terms appearing in only one headline are kept only when that headline itself
 * scored highly — otherwise a single obscure item contributes noise terms that
 * will match arbitrary articles later.
 */
export function rankTerms(
  headlines: { title: string; weight?: number }[],
  opts: { limit?: number; minCount?: number } = {},
): WeightedTerm[] {
  const limit = opts.limit ?? 60;
  const minCount = opts.minCount ?? 1;

  const totals = new Map<string, { score: number; count: number }>();
  for (const h of headlines) {
    const prior = Math.max(0, h.weight ?? 1);
    for (const phrase of new Set(extractPhrases(h.title))) {
      const bigramBoost = phrase.includes(" ") ? 1.6 : 1;
      const cur = totals.get(phrase) ?? { score: 0, count: 0 };
      cur.score += prior * bigramBoost;
      cur.count += 1;
      totals.set(phrase, cur);
    }
  }

  const kept = [...totals.entries()].filter(([, v]) => v.count >= minCount);
  if (kept.length === 0) return [];

  const max = Math.max(...kept.map(([, v]) => v.score));
  if (max <= 0) return [];

  return kept
    .map(([term, v]) => ({ term, weight: v.score / max }))
    .sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.term.localeCompare(b.term)))
    .slice(0, limit);
}

/**
 * Which trending terms an article matches.
 *
 * Matching is whole-phrase against space-padded normalized text, the same trick
 * `topics.ts` uses: it gives word-boundary matching without per-term regex
 * escaping, so "rates" doesn't match "corporates".
 *
 * Only the title and the lead of the excerpt are scanned. Body text mentions
 * everything in passing, and a trending boost earned by a throwaway sentence
 * halfway down an article is exactly the kind of false positive that makes a
 * ranked feed feel random.
 */
export function matchTerms(
  article: { title: string; excerpt?: string | null },
  terms: WeightedTerm[],
): WeightedTerm[] {
  const haystack = ` ${normalizeTerm(`${article.title} ${(article.excerpt ?? "").slice(0, 300)}`)} `;
  const out: WeightedTerm[] = [];
  for (const t of terms) {
    if (t.term && haystack.includes(` ${t.term} `)) out.push(t);
  }
  return out;
}

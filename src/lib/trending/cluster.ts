/**
 * Grouping many tellings of one story into a single cluster.
 *
 * ## Why cluster at all
 *
 * Everything downstream depends on it. Trending is mostly a corroboration
 * measure ("six independent outlets carried this"), and you cannot count
 * outlets per story until you know which articles ARE the same story. It also
 * fixes a long-standing brief complaint: the same wire story syndicated to six
 * feeds used to consume six of the brief's limited slots, crowding out
 * everything else. Clustered, it becomes one item that happens to cite six
 * sources — better ranking AND better coverage from the same token budget.
 *
 * ## How
 *
 * Two passes, cheapest first:
 *
 *   1. **Title shingles.** Syndicated copy usually shares a near-identical
 *      headline, and Jaccard overlap over word trigrams catches that for free,
 *      with no embedding required.
 *   2. **Embeddings.** Articles are already embedded into pgvector for search
 *      and RAG (`article_embeddings`, backfilled every 6h), so the vectors are
 *      sitting there paid-for. Cosine similarity catches the harder case —
 *      "Fed holds rates steady" and "No change from the FOMC" — that no amount
 *      of word overlap ever will.
 *
 * Both feed one union-find, so the two passes merge into the same clusters
 * rather than competing.
 *
 * ## Why in memory
 *
 * The obvious implementation asks pgvector for each article's neighbours, which
 * is one indexed query per article — a few hundred round trips inside a
 * function that gets killed at ~10s. Instead the whole recent window is
 * fetched once and compared in process. A few hundred vectors is a few MB and
 * the pairwise pass is trivially fast; it's the round trips that cost, not the
 * arithmetic.
 *
 * Pure and dependency-free, so it's unit-testable: the caller does the I/O.
 */

// ── Tunables ────────────────────────────────────────────────────────────

/**
 * Cosine similarity at which two articles are "the same story".
 *
 * Deliberately high. The failure modes are asymmetric: merging two different
 * stories invents corroboration that doesn't exist and actively misinforms the
 * ranking, while failing to merge two tellings merely leaves a story
 * under-credited. When in doubt, don't merge.
 */
export const SIMILARITY_THRESHOLD = 0.82;

/** Jaccard overlap over title trigrams that counts as the same headline. */
export const TITLE_SHINGLE_THRESHOLD = 0.5;

/** Words in a title shingle. */
const SHINGLE_SIZE = 3;

/**
 * Two articles can only be merged if their publish dates are within this many
 * hours. Anniversary pieces and follow-ups a month later are genuinely about
 * the same subject and will happily pass a similarity check — but they are not
 * the same *event*, and letting them merge would age clusters backwards.
 */
export const CLUSTER_WINDOW_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

/** Stop words carry no topical signal and wreck short-title overlap. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "that", "this", "these", "those", "how", "why", "what", "after",
  "over", "into", "amid", "says", "say", "said", "new",
]);

export type ClusterableArticle = {
  id: string;
  title: string;
  feedId: string;
  publishDate: Date | null;
  /** From `article_embeddings`; absent when the backfill hasn't reached it. */
  embedding?: number[] | null;
};

export type Cluster = {
  /** Member article ids, in the order given. */
  articleIds: string[];
  /** DISTINCT feeds among the members — the corroboration count. */
  distinctFeeds: number;
  firstSeen: Date;
  lastSeen: Date;
};

/**
 * Normalized word list for a title: lowercased, punctuation stripped, stop
 * words removed. Mirrors the normalization in `src/lib/today/topics.ts` so
 * desks and clusters agree about what a word is.
 */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Word n-grams for a title. Falls back to single words for titles too short to
 * form one shingle, so a 3-word headline still compares against something.
 */
export function titleShingles(title: string, size: number = SHINGLE_SIZE): Set<string> {
  const words = titleWords(title);
  if (words.length === 0) return new Set();
  if (words.length < size) return new Set(words);
  const out = new Set<string>();
  for (let i = 0; i <= words.length - size; i += 1) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Cosine similarity. Returns 0 on any dimension mismatch rather than throwing —
 * a stale embedding row from before a model change must degrade the clustering,
 * not take down the cron.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Union-find with path compression — the merge structure for both passes. */
class DisjointSet {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression, iterative: recursion would blow the stack on a long
    // chain of same-story articles, which is exactly the case we build for.
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Whether two articles are close enough in time to be the same event. */
function withinWindow(a: ClusterableArticle, b: ClusterableArticle): boolean {
  if (!a.publishDate || !b.publishDate) return true; // undated: let similarity decide
  return Math.abs(a.publishDate.getTime() - b.publishDate.getTime()) <= CLUSTER_WINDOW_HOURS * HOUR_MS;
}

/**
 * Cluster a window of articles into stories.
 *
 * O(n²) in the window size, which is fine and deliberate: the window is capped
 * by the caller at a few hundred recent articles, and 200² = 40k cheap
 * comparisons is microseconds. Swapping in an approximate-neighbour index here
 * would trade real accuracy for time we are not short of.
 *
 * Single-article clusters are returned too — a story only one outlet carried is
 * still a story, it just scores low on corroboration.
 */
export function clusterArticles(items: ClusterableArticle[]): Cluster[] {
  const n = items.length;
  if (n === 0) return [];

  const shingles = items.map((a) => titleShingles(a.title));
  const ds = new DisjointSet(n);

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (!withinWindow(items[i], items[j])) continue;

      // Cheap pass first: identical/near-identical headlines, no vectors needed.
      if (jaccard(shingles[i], shingles[j]) >= TITLE_SHINGLE_THRESHOLD) {
        ds.union(i, j);
        continue;
      }

      const ea = items[i].embedding;
      const eb = items[j].embedding;
      if (ea && eb && cosine(ea, eb) >= SIMILARITY_THRESHOLD) {
        ds.union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = ds.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const clusters: Cluster[] = [];
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => items[i]);
    const feeds = new Set(members.map((m) => m.feedId));
    const dates = members
      .map((m) => m.publishDate)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    const firstSeen = dates[0] ?? new Date();
    const lastSeen = dates[dates.length - 1] ?? firstSeen;
    clusters.push({
      articleIds: members.map((m) => m.id),
      distinctFeeds: feeds.size,
      firstSeen,
      lastSeen,
    });
  }
  return clusters;
}

/**
 * The headline that best represents a cluster.
 *
 * Prefers the title whose words are most typical of the cluster as a whole: a
 * story's shared substance shows up in most members, while one outlet's
 * editorialising ("Here's what nobody is telling you about…") does not. Length
 * breaks ties downward, since the shortest way to say the shared thing is
 * usually the wire copy.
 */
export function representativeTitle(titles: string[]): string {
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0];

  const freq = new Map<string, number>();
  for (const t of titles) {
    for (const w of new Set(titleWords(t))) freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  let best = titles[0];
  let bestScore = -1;
  for (const t of titles) {
    const words = [...new Set(titleWords(t))];
    if (words.length === 0) continue;
    const typicality = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / words.length;
    if (typicality > bestScore || (typicality === bestScore && t.length < best.length)) {
      bestScore = typicality;
      best = t;
    }
  }
  return best;
}

import { jaccard, titleWords } from "@/lib/trending/cluster";

/**
 * Collapsing a feed list into stories.
 *
 * ## Four answers to "is this the same story", in order of confidence
 *
 * 1. **Cluster id** — the trending pass compares title shingles AND embeddings
 *    and writes its verdict onto every article it scores. That is the strongest
 *    signal available and it wins outright.
 * 2. **Canonical URL** — the same link carried by two feeds is the same
 *    article, whatever the two feeds decided to call it. Tracking parameters,
 *    `www.`, AMP suffixes and fragments are stripped first, because those are
 *    exactly what makes two identical links compare unequal.
 * 3. **Normalized title** — now with the outlet suffix removed, so
 *    "Fed holds rates steady - Reuters" and "Fed holds rates steady | CNBC"
 *    stop being two stories.
 * 4. **Near-match on title words** — Jaccard overlap, plus a containment rule
 *    for the very common case of one outlet running the same headline with a
 *    trailing clause bolted on.
 *
 * ## Why the list needs its own answer at all
 *
 * The list used to have only (3), and only in its strictest form: exact string
 * equality after lowercasing and stripping punctuation. That catches a wire
 * report syndicated verbatim and almost nothing else, which is why collapsing
 * looked broken — most rows fall outside the trending pass's window or arrive
 * before the hourly cron has scored them, and every one of those fell back to a
 * comparison that essentially never fired.
 *
 * ## What this deliberately does NOT do
 *
 * Genuinely reworded headlines — "Fed holds rates steady" against "Fed leaves
 * rates unchanged" — share too few words for any lexical rule to catch without
 * also merging stories that only look alike. Those need embeddings, which is
 * what the trending pass has and the browser does not. The answer there is
 * better cluster coverage, not a looser threshold here.
 *
 * ## Why collapsing hides rather than filters
 *
 * The old toggle DROPPED the duplicate rows, which quietly threw away the most
 * interesting thing about a story: that six outlets bothered. Here the extra
 * tellings stay attached to the row that represents them and can be expanded,
 * so the reader can still see who else carried it — and marking the story read
 * can take all of them with it, which is the actual chore being solved.
 */

/** What grouping needs from a row. Deliberately structural — the list, the
 *  search results and any future caller all satisfy it. */
export type StoryItem = {
  id: string;
  title: string;
  /** From the trending pass; absent on unscored rows and search results. */
  clusterId?: string | null;
  /** The article link, when the caller has one. Used for syndication matching. */
  url?: string | null;
};

export type StoryGrouping<T extends StoryItem> = {
  /** The rows to render, in order, with collapsed tellings removed. */
  visible: T[];
  /** Lead id → its other tellings, whether or not they are currently shown. */
  tellings: Map<string, T[]>;
};

/**
 * Word-overlap at which two headlines are the same story.
 *
 * High on purpose. A false merge hides an article the reader never chose to
 * hide, which is worse than showing two rows — the same asymmetry the trending
 * clusterer is built around, pointed the other way.
 */
export const TITLE_OVERLAP_THRESHOLD = 0.6;

/**
 * How much of the SHORTER headline must appear in the longer one to merge them
 * regardless of overall overlap. This is the "same headline plus a trailing
 * clause" case — "Fed holds rates steady" against "Fed holds rates steady as
 * inflation cools" — where plain Jaccard is dragged down by length alone.
 */
export const TITLE_CONTAINMENT_THRESHOLD = 0.85;

/** Query parameters that identify a referrer, not a document. */
const TRACKING_PARAM = /^(utm_|ito$|at_|mc_|pk_|piwik_|ref$|referrer$|source$|src$|cmpid$|cmp$|fbclid$|gclid$|igshid$|mbid$|smid$|partner$|sh$|taid$|guccounter$)/i;

/**
 * A URL reduced to the document it points at.
 *
 * Returns null for anything unparseable, which callers treat as "no URL
 * evidence" rather than as a key — grouping every malformed link together
 * would be a spectacular way to hide unrelated articles.
 */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  // Sorted so two feeds that list the same parameters in a different order
  // still produce the same key.
  u.searchParams.sort();

  // AMP copies are the same document as the page they mirror.
  let path = u.pathname.replace(/\/(amp|amp\.html)$/i, "").replace(/\.amp$/i, "");
  if (path.length > 1) path = path.replace(/\/+$/, "");

  const query = u.searchParams.toString();
  return `${host}${path}${query ? `?${query}` : ""}`;
}

const OUTLET_SEPARATOR = /\s+[-–—|]\s+/g;
/** An outlet name is a few words at most: "Reuters", "The New York Times". */
const MAX_OUTLET_WORDS = 4;
const MAX_OUTLET_CHARS = 25;
/** Below this the head is too thin to be a headline on its own. */
const MIN_HEAD_WORDS = 3;

/**
 * Drop the outlet suffix feeds append: " - Reuters", " | BBC News",
 * " — The Verge".
 *
 * Judged on the tail's WORD COUNT rather than its character length, which an
 * earlier version got wrong: at a 30-character limit, "Summit collapses — what
 * happens to the talks now" lost its entire second half and became a headline
 * that would merge with any other story about a summit collapsing. Counting
 * words separates "The New York Times" (four) from a real clause (six or more)
 * in a way that counting characters cannot.
 */
function stripOutletSuffix(title: string): string {
  const separators = [...title.matchAll(OUTLET_SEPARATOR)];
  const last = separators[separators.length - 1];
  if (!last || last.index === undefined) return title;

  const head = title.slice(0, last.index).trim();
  const tail = title.slice(last.index + last[0].length).trim();
  if (!head || !tail) return title;

  const tailWords = tail.split(/\s+/).length;
  if (tailWords > MAX_OUTLET_WORDS || tail.length > MAX_OUTLET_CHARS) return title;
  // Refuse to reduce a headline to a fragment. "AI — The Verge" keeps both
  // halves rather than becoming the single word "AI", which would collapse
  // every AI story into one row.
  if (head.split(/\s+/).length < MIN_HEAD_WORDS) return title;

  return head;
}

/** Normalize a title for matching: outlet suffix removed, then flattened. */
export function normalizeTitle(title: string): string {
  return stripOutletSuffix(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The story a row belongs to, for callers that only need a key rather than a
 * full grouping (and for the tests). Cluster id when the trending pass has
 * grouped it, normalized title otherwise — prefixed so a cluster uuid can never
 * collide with a title that happens to look like one.
 */
export function storyKey(item: StoryItem): string {
  return item.clusterId ? `c:${item.clusterId}` : `t:${normalizeTitle(item.title)}`;
}

/** True when two headlines are close enough to be one story. */
export function titlesMatch(a: string, b: string): boolean {
  const wa = new Set(titleWords(normalizeTitle(a)));
  const wb = new Set(titleWords(normalizeTitle(b)));
  // A headline of nothing but stop words gives us no evidence either way.
  if (wa.size === 0 || wb.size === 0) return false;
  if (jaccard(wa, wb) >= TITLE_OVERLAP_THRESHOLD) return true;

  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  // Two words in common is not a headline, it's a coincidence.
  if (small.size < 3) return false;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared += 1;
  return shared / small.size >= TITLE_CONTAINMENT_THRESHOLD;
}

type Lead<T> = {
  item: T;
  clusterId: string | null;
  words: Set<string>;
};

/**
 * Group a list into stories.
 *
 * The FIRST row of a story leads it, which matters because the list arrives
 * already sorted: under the trending sort every telling of a story shares its
 * score and they sort adjacently, so the lead is the newest telling of the
 * hottest story rather than an arbitrary one. Order is otherwise untouched —
 * collapsing must never reorder a list the reader has just sorted.
 *
 * With `collapse` off this returns the input unchanged and an empty map, so
 * the caller can render one code path either way.
 */
export function groupStories<T extends StoryItem>(
  items: T[],
  opts: { collapse: boolean; expanded?: ReadonlySet<string> },
): StoryGrouping<T> {
  if (!opts.collapse) return { visible: items, tellings: new Map() };

  const expanded = opts.expanded ?? new Set<string>();
  const tellings = new Map<string, T[]>();
  const visible: T[] = [];

  const byCluster = new Map<string, Lead<T>>();
  const byUrl = new Map<string, Lead<T>>();
  const byTitle = new Map<string, Lead<T>>();
  // Inverted index: a word → the leads whose headline contains it. Keeps the
  // near-match pass off an O(n²) comparison of every row against every lead.
  const byWord = new Map<string, Lead<T>[]>();

  const join = (lead: Lead<T>, item: T) => {
    tellings.get(lead.item.id)?.push(item);
    // An expanded story shows its tellings in place, immediately after the
    // lead — which they already are, since the list is in story order.
    if (expanded.has(lead.item.id)) visible.push(item);
  };

  for (const item of items) {
    const clusterId = item.clusterId ?? null;
    const url = canonicalUrl(item.url);
    const normalized = normalizeTitle(item.title);

    let match: Lead<T> | undefined;

    if (clusterId) {
      // The trending pass has ruled on this row. Its verdict is the only one
      // that applies: a row it placed in cluster X must never be merged into a
      // row it placed in cluster Y on the strength of a weaker lexical guess.
      match = byCluster.get(clusterId);
    } else {
      match = (url ? byUrl.get(url) : undefined) ?? byTitle.get(normalized);
      if (!match) {
        const words = new Set(titleWords(normalized));
        const seen = new Set<Lead<T>>();
        for (const w of words) {
          for (const candidate of byWord.get(w) ?? []) {
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            if (titlesMatch(item.title, candidate.item.title)) {
              match = candidate;
              break;
            }
          }
          if (match) break;
        }
      }
    }

    if (match) {
      join(match, item);
      continue;
    }

    const lead: Lead<T> = { item, clusterId, words: new Set(titleWords(normalized)) };
    tellings.set(item.id, []);
    visible.push(item);

    if (clusterId) byCluster.set(clusterId, lead);
    if (url && !byUrl.has(url)) byUrl.set(url, lead);
    if (normalized && !byTitle.has(normalized)) byTitle.set(normalized, lead);
    for (const w of lead.words) {
      const bucket = byWord.get(w);
      if (bucket) bucket.push(lead);
      else byWord.set(w, [lead]);
    }
  }

  return { visible, tellings };
}

/**
 * Every article id that marking this row read should cover: the row itself,
 * plus the tellings collapsed under it.
 *
 * Only when the story is COLLAPSED. Once the reader has expanded it, the other
 * tellings are rows on screen with their own unread state, and marking one of
 * them read behind the reader's back is exactly the kind of silent bulk action
 * that makes people distrust a reading list.
 */
export function storyReadTargets<T extends StoryItem>(
  id: string,
  grouping: StoryGrouping<T>,
  expanded: ReadonlySet<string>,
): string[] {
  if (expanded.has(id)) return [id];
  const others = grouping.tellings.get(id);
  if (!others || others.length === 0) return [id];
  return [id, ...others.map((o) => o.id)];
}

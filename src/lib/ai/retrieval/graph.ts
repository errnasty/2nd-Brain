import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Graph traversal for Ask retrieval.
 *
 * Ask used to rank every item independently by cosine similarity, which means
 * two items the user explicitly connected — a note that [[wikilinks]] another,
 * two items they filed under the same tag — were as unrelated to retrieval as
 * two items that had never met. The knowledge graph was already there
 * (directory_links, item_tags, folder membership) and even walked breadth-first
 * — but only by /api/map, to draw a picture. Nothing traversed it to *answer*
 * anything.
 *
 * So the graph gets walked on every question: take the items vector/keyword
 * search actually found, follow the user's own edges out from them, and admit
 * the neighbours that survive scoring. This retrieves the note that never
 * mentions the query's words but is one hop from three items that do.
 *
 * Traversal is unconditional by design. Gating it behind "does this question
 * look graph-shaped?" makes retrieval quality a property of how the question
 * was phrased, which is exactly the failure it exists to remove.
 */

export type EdgeKind = "wikilink" | "tag" | "folder";

/** One edge that helped pull a neighbour in — kept for explanation, not just scoring. */
export type GraphPath = {
  kind: EdgeKind;
  /** The already-retrieved item this edge was followed from. */
  fromItemId: string;
  /** Tag or folder name for tag/folder edges; undefined for wikilinks. */
  label?: string;
  /** When the edge was formed, when the row records it. */
  at?: string;
};

export type GraphNeighbor = {
  directoryItemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  /** Traversal score — NOT a cosine similarity. Never compare the two directly. */
  score: number;
  /** Edge count from the nearest seed (1 = directly connected to a hit). */
  hops: number;
  paths: GraphPath[];
};

export type GraphSeed = { directoryItemId: string; similarity: number };

/**
 * How much of a seed's score an edge carries.
 *
 * A wikilink is a person deliberately writing "this relates to that", so it
 * carries nearly all of it. A shared tag is a weaker, often-automatic claim
 * (some are AI-assigned — item_tags.source = 'ai'). Sharing a folder is the
 * weakest: it frequently means "filed on the same afternoon" and nothing more,
 * so alone it can only ever reach the uncertain band below.
 */
const EDGE_WEIGHT: Record<EdgeKind, number> = {
  wikilink: 1.0,
  tag: 0.55,
  folder: 0.3,
};

/** Score retained per extra hop. Two hops out is a hint, not evidence. */
const HOP_DECAY = 0.55;

/**
 * Two-threshold admission.
 *
 * A single cutoff has to be either strict (losing genuinely connected items) or
 * loose (dragging in everything sharing a busy tag). Two cutoffs let the middle
 * stay honest instead of guessing: above ADMIT the edge speaks for itself,
 * below REJECT it is noise, and in between the neighbour is admitted only if
 * something *else* corroborates it — a second kind of edge, or a second
 * independent seed pointing at the same item.
 */
const ADMIT_SCORE = 0.3;
const REJECT_SCORE = 0.12;

/**
 * Edges carry the date they were formed, so an edge can be weighted by whether
 * it is still fresh. This is deliberately gentle (never below RECENCY_FLOOR):
 * a link written two years ago is old, not wrong.
 *
 * This reads the one timestamp each edge row happens to have. It is not
 * bitemporality — the rows record when an edge was *written*, never the period
 * it was *true for*, and a deleted link leaves no history at all. Real
 * valid-time/transaction-time support would need those columns first.
 */
const RECENCY_FLOOR = 0.8;
const RECENCY_HALFLIFE_DAYS = 365;

/**
 * Fan-out caps. A tag on 200 items asserts almost nothing about any pair of
 * them, and expanding it would cost a 200-row cross join to say so. Skipping
 * over-broad tags and folders is both the cheaper and the more accurate call.
 */
const MAX_TAG_FANOUT = 40;
const MAX_FOLDER_FANOUT = 60;
/** Ceiling on rows pulled per hop, so one dense neighbourhood can't run away. */
const MAX_EDGE_ROWS = 400;

type EdgeRow = { a: string; b: string; label: string | null; at: string | null };

/** Edge queries are advisory: if one fails, traversal degrades instead of taking Ask down. */
async function safeRows(run: () => Promise<unknown>): Promise<EdgeRow[]> {
  try {
    return (await run()) as unknown as EdgeRow[];
  } catch (err) {
    console.warn("graph edge query failed (skipping):", err instanceof Error ? err.message : err);
    return [];
  }
}

function recencyFactor(at: string | null): number {
  if (!at) return 1;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return 1;
  const ageDays = Math.max(0, (Date.now() - ms) / 86_400_000);
  const decay = Math.exp((-Math.LN2 * ageDays) / RECENCY_HALFLIFE_DAYS);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

/** Wikilinks, in both directions — a link is a relationship regardless of who authored it. */
function wikilinkEdges(userId: string, frontier: string[]): Promise<EdgeRow[]> {
  return safeRows(() =>
    db.execute(sql`
      select
        case when dl.source_item_id = any(${frontier}::uuid[]) then dl.source_item_id else dl.target_item_id end as a,
        case when dl.source_item_id = any(${frontier}::uuid[]) then dl.target_item_id else dl.source_item_id end as b,
        null::text as label,
        dl.created_at as at
      from directory_links dl
      where dl.user_id = ${userId}
        and (dl.source_item_id = any(${frontier}::uuid[]) or dl.target_item_id = any(${frontier}::uuid[]))
      limit ${MAX_EDGE_ROWS}
    `),
  );
}

/** Co-tagged items, skipping tags too broad to mean anything. */
function tagEdges(userId: string, frontier: string[]): Promise<EdgeRow[]> {
  return safeRows(() =>
    db.execute(sql`
      with seed_tags as (
        select it.tag_id, it.item_id as seed_id
        from item_tags it
        where it.user_id = ${userId}
          and it.item_kind = 'directory_item'
          and it.item_id = any(${frontier}::uuid[])
      ),
      tag_size as (
        select tag_id, count(*) as n
        from item_tags
        where user_id = ${userId} and item_kind = 'directory_item'
        group by tag_id
      )
      select st.seed_id as a, it2.item_id as b, tg.name as label, it2.created_at as at
      from seed_tags st
      join tag_size ts on ts.tag_id = st.tag_id and ts.n <= ${MAX_TAG_FANOUT}
      join item_tags it2
        on it2.tag_id = st.tag_id
       and it2.user_id = ${userId}
       and it2.item_kind = 'directory_item'
       and it2.item_id <> st.seed_id
      join tags tg on tg.id = st.tag_id
      limit ${MAX_EDGE_ROWS}
    `),
  );
}

/** Items sharing a folder, skipping folders large enough to be a filing cabinet. */
function folderEdges(userId: string, frontier: string[]): Promise<EdgeRow[]> {
  return safeRows(() =>
    db.execute(sql`
      with seed_folders as (
        select distinct di.folder_id, di.id as seed_id
        from directory_items di
        where di.user_id = ${userId}
          and di.folder_id is not null
          and di.id = any(${frontier}::uuid[])
      ),
      folder_size as (
        select folder_id, count(*) as n
        from directory_items
        where user_id = ${userId} and folder_id is not null
        group by folder_id
      )
      select sf.seed_id as a, di2.id as b, fo.name as label, di2.updated_at as at
      from seed_folders sf
      join folder_size fs on fs.folder_id = sf.folder_id and fs.n <= ${MAX_FOLDER_FANOUT}
      join directory_items di2
        on di2.folder_id = sf.folder_id
       and di2.user_id = ${userId}
       and di2.id <> sf.seed_id
      join directory_folders fo on fo.id = sf.folder_id
      limit ${MAX_EDGE_ROWS}
    `),
  );
}

/** Running traversal state for one candidate neighbour. */
type Candidate = {
  best: number;
  hops: number;
  paths: GraphPath[];
  edgeKinds: Set<EdgeKind>;
  seeds: Set<string>;
};

/**
 * Score a neighbour set breadth-first from `seeds`, then admit on two
 * thresholds. Pure apart from the edge queries, so the scoring is unit-tested
 * through `admit` / `scoreEdge` below.
 */
export async function expandByGraph(
  userId: string,
  seeds: GraphSeed[],
  opts: { maxHops?: number; cap?: number } = {},
): Promise<GraphNeighbor[]> {
  const maxHops = opts.maxHops ?? 2;
  const cap = opts.cap ?? 4;
  if (seeds.length === 0) return [];

  const seedIds = new Set(seeds.map((s) => s.directoryItemId));
  // A seed's own similarity is what its edges divide up, so an item retrieved
  // on a weak match cannot promote its neighbours above itself.
  const seedScore = new Map(seeds.map((s) => [s.directoryItemId, s.similarity]));
  const candidates = new Map<string, Candidate>();

  // `carried` is the score flowing out of each frontier node: the seed's own
  // similarity at hop 1, then whatever survived the previous hop's decay.
  let frontier = seeds.map((s) => s.directoryItemId);
  let carried = new Map(seedScore);
  const visited = new Set(frontier);

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const [wiki, tag, folder] = await Promise.all([
      wikilinkEdges(userId, frontier),
      tagEdges(userId, frontier),
      folderEdges(userId, frontier),
    ]);

    const nextCarried = new Map<string, number>();
    const record = (rows: EdgeRow[], kind: EdgeKind) => {
      for (const row of rows) {
        if (!row.a || !row.b) continue;
        // Seeds are already being retrieved on their own merit; re-admitting one
        // as its own neighbour would double-count it.
        if (seedIds.has(row.b)) continue;
        const from = carried.get(row.a);
        if (from === undefined) continue;

        const score = from * EDGE_WEIGHT[kind] * recencyFactor(row.at) * Math.pow(HOP_DECAY, hop - 1);
        const existing = candidates.get(row.b);
        const path: GraphPath = {
          kind,
          fromItemId: row.a,
          label: row.label ?? undefined,
          at: row.at ?? undefined,
        };
        if (!existing) {
          candidates.set(row.b, {
            best: score,
            hops: hop,
            paths: [path],
            edgeKinds: new Set([kind]),
            seeds: new Set([row.a]),
          });
        } else {
          existing.best = Math.max(existing.best, score);
          existing.hops = Math.min(existing.hops, hop);
          existing.edgeKinds.add(kind);
          existing.seeds.add(row.a);
          // Keep a bounded, readable set of reasons rather than every path.
          if (existing.paths.length < 4) existing.paths.push(path);
        }
        nextCarried.set(row.b, Math.max(nextCarried.get(row.b) ?? 0, score));
      }
    };

    record(wiki, "wikilink");
    record(tag, "tag");
    record(folder, "folder");

    // Next frontier: newly-seen nodes only, so a cycle can't loop forever.
    const next: string[] = [];
    for (const id of nextCarried.keys()) {
      if (!visited.has(id)) {
        visited.add(id);
        next.push(id);
      }
    }
    frontier = next;
    carried = nextCarried;
  }

  const admitted = Array.from(candidates.entries())
    .map(([id, c]) => ({ id, c, score: finalScore(c) }))
    .filter(({ c, score }) => admit(score, c.edgeKinds.size, c.seeds.size))
    .sort((x, y) => y.score - x.score)
    .slice(0, cap);

  if (admitted.length === 0) return [];

  const ids = admitted.map((a) => a.id);
  const rows = await safeRows(() =>
    db.execute(sql`
      select id as a, title as b, kind as label, null::text as at
      from directory_items
      where user_id = ${userId} and id = any(${ids}::uuid[])
    `),
  );
  const meta = new Map(rows.map((r) => [r.a, { title: r.b, kind: r.label }]));

  return admitted
    .map(({ id, c, score }) => {
      const m = meta.get(id);
      if (!m) return null; // row vanished or is not this user's — drop it
      return {
        directoryItemId: id,
        title: m.title,
        kind: m.kind as GraphNeighbor["kind"],
        score: Math.round(score * 1000) / 1000,
        hops: c.hops,
        paths: c.paths,
      };
    })
    .filter((n): n is GraphNeighbor => n !== null);
}

/**
 * Corroboration bonus: an item reached by two different kinds of edge, or from
 * two different retrieved items, is better connected to the question than one
 * hanging off a single edge, and the score should say so.
 */
export function finalScore(c: Pick<Candidate, "best" | "edgeKinds" | "seeds">): number {
  const corroborations = Math.max(c.edgeKinds.size, c.seeds.size);
  return c.best * (1 + 0.15 * Math.min(corroborations - 1, 3));
}

/**
 * The two-threshold decision. Above ADMIT the edge stands on its own; below
 * REJECT nothing rescues it; the band between needs a second, independent
 * reason — which is the point of having a band rather than picking one cutoff.
 */
export function admit(score: number, edgeKinds: number, seedCount: number): boolean {
  if (score >= ADMIT_SCORE) return true;
  if (score < REJECT_SCORE) return false;
  return edgeKinds >= 2 || seedCount >= 2;
}

/** Human-readable "why this is here", for the prompt and the source list. */
export function describePath(paths: GraphPath[], titleOf: (id: string) => string | undefined): string {
  const parts: string[] = [];
  for (const p of paths.slice(0, 2)) {
    const from = titleOf(p.fromItemId);
    if (p.kind === "wikilink") parts.push(from ? `linked from "${from}"` : "linked from a matched item");
    else if (p.kind === "tag") parts.push(p.label ? `shares tag "${p.label}"` : "shares a tag");
    else parts.push(p.label ? `filed in "${p.label}"` : "shares a folder");
  }
  return parts.join("; ");
}

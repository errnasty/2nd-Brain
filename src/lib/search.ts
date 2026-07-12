import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, directoryItems } from "@/lib/db/schema";

/**
 * Full-library search backing /search. Two complementary passes:
 *
 * - KEYWORD: trigram-accelerated ILIKE over feed articles + Directory items
 *   (same predicate family as the ⌘K palette, higher limits). Always runs.
 * - SEMANTIC: embedding similarity over the Directory (uploaded-document
 *   chunks, saved-article embeddings, note embeddings) via
 *   retrieveFromDirectory. Fail-soft: no provider / no embeddings ⇒ [].
 *
 * Results stay in two sections (they answer different questions: "contains
 * these words" vs "is about this"); semantic hits duplicated by a keyword
 * hit are dropped from the keyword list, keeping the sharper snippet.
 */

export type SearchKindFilter = "all" | "articles" | "notes" | "documents";

export type SearchHit = {
  id: string;
  title: string;
  kind: "article" | "saved_article" | "uploaded_document" | "user_note";
  snippet: string | null;
  href: string;
  /** Only on semantic hits. */
  similarity?: number;
};

export type SearchResults = {
  keyword: SearchHit[];
  semantic: SearchHit[];
  semanticAvailable: boolean;
};

const DIRECTORY_KINDS: Record<
  Exclude<SearchKindFilter, "all">,
  Array<"saved_article" | "uploaded_document" | "user_note">
> = {
  articles: ["saved_article"],
  notes: ["user_note"],
  documents: ["uploaded_document"],
};

function itemHref(kind: SearchHit["kind"], id: string): string {
  return kind === "article" ? `/feeds?article=${id}` : `/directory?item=${id}`;
}

export async function searchLibrary(
  userId: string,
  rawQuery: string,
  kind: SearchKindFilter = "all",
): Promise<SearchResults> {
  const q = rawQuery.trim();
  if (q.length < 2) return { keyword: [], semantic: [], semanticAvailable: false };
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const wantFeedArticles = kind === "all" || kind === "articles";
  const directoryKinds = kind === "all" ? null : DIRECTORY_KINDS[kind];

  const [feedHits, itemHits, semanticRaw] = await Promise.all([
    wantFeedArticles
      ? db
          .select({ id: articles.id, title: articles.title, excerpt: articles.excerpt })
          .from(articles)
          .where(
            and(
              eq(articles.userId, userId),
              or(ilike(articles.title, pattern), ilike(articles.excerpt, pattern)),
            ),
          )
          .orderBy(desc(articles.publishDate))
          .limit(25)
      : Promise.resolve([]),
    db
      .select({
        id: directoryItems.id,
        title: directoryItems.title,
        kind: directoryItems.kind,
        content: directoryItems.content,
      })
      .from(directoryItems)
      .where(
        and(
          eq(directoryItems.userId, userId),
          directoryKinds ? inArray(directoryItems.kind, directoryKinds) : undefined,
          or(ilike(directoryItems.title, pattern), ilike(directoryItems.content, pattern)),
        ),
      )
      .orderBy(desc(directoryItems.updatedAt))
      .limit(25),
    semanticSearch(userId, q),
  ]);

  const semantic = semanticRaw.filter(
    (h) =>
      !directoryKinds ||
      directoryKinds.includes(h.kind as (typeof directoryKinds)[number]) ||
      // Unsaved feed articles count as articles for the filter chips.
      (kind === "articles" && h.kind === "article"),
  );
  const semanticIds = new Set(semantic.map((h) => h.id));

  const keyword: SearchHit[] = [
    ...itemHits
      .filter((i) => !semanticIds.has(i.id))
      .map((i) => ({
        id: i.id,
        title: i.title,
        kind: i.kind,
        snippet: i.content ? excerptAround(i.content, q) : null,
        href: itemHref(i.kind, i.id),
      })),
    ...feedHits.map((a) => ({
      id: a.id,
      title: a.title,
      kind: "article" as const,
      snippet: a.excerpt,
      href: itemHref("article", a.id),
    })),
  ];

  return { keyword, semantic, semanticAvailable: semanticRaw.length > 0 };
}

/** First occurrence of the query with surrounding context, else the head. */
function excerptAround(content: string, q: string, radius = 90): string {
  const i = content.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(content.length, i + q.length + radius);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

async function semanticSearch(userId: string, q: string): Promise<SearchHit[]> {
  try {
    const [directoryHits, articleHits] = await Promise.all([
      directorySemantic(userId, q),
      unsavedArticleSemantic(userId, q),
    ]);
    return [...directoryHits, ...articleHits]
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, 12);
  } catch {
    // No embeddings provider configured / no vectors yet — keyword-only.
    return [];
  }
}

async function directorySemantic(userId: string, q: string): Promise<SearchHit[]> {
  const { retrieveFromDirectory } = await import("@/lib/ai/rag");
  const sources = await retrieveFromDirectory(userId, q, 10);
  return sources.map((s) => ({
    id: s.directoryItemId,
    title: s.title,
    kind: s.kind,
    snippet: s.snippet,
    href: itemHref(s.kind, s.directoryItemId),
    similarity: s.similarity,
  }));
}

/**
 * Semantic hits over feed articles that were NEVER saved to the Directory —
 * retrieveFromDirectory can't see those (it joins through directory_items).
 * Saved articles are excluded here so each article appears at most once.
 */
async function unsavedArticleSemantic(userId: string, q: string): Promise<SearchHit[]> {
  try {
    const { sql } = await import("drizzle-orm");
    const { clampForEmbedding, getEmbeddingsProvider, toVectorLiteral } = await import(
      "@/lib/embeddings"
    );
    const provider = getEmbeddingsProvider();
    const [vector] = await provider.embed([clampForEmbedding(q)], "query");
    const lit = toVectorLiteral(vector);

    const rows = (await db.execute(sql`
      select
        a.id,
        a.title,
        substring(coalesce(a.excerpt, a.full_text, ''), 1, 400) as snippet,
        1 - (e.embedding <=> ${lit}::vector) as similarity
      from article_embeddings e
      inner join articles a on a.id = e.article_id
      where e.user_id = ${userId}
        and not exists (
          select 1 from directory_items di
          where di.article_id = a.id and di.user_id = ${userId}
        )
      order by e.embedding <=> ${lit}::vector
      limit 6
    `)) as unknown as Array<{ id: string; title: string; snippet: string; similarity: number }>;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: "article" as const,
      snippet: r.snippet || null,
      href: itemHref("article", r.id),
      similarity: Number(r.similarity),
    }));
  } catch {
    return [];
  }
}

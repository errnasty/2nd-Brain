import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookReadingState, directoryItems, documents, itemTags, tags } from "@/lib/db/schema";

export type ReadingStatus = "inbox" | "reading" | "done" | "review";

export type DirItem = {
  id: string;
  title: string;
  preview: string | null;
  kind: "saved_article" | "uploaded_document" | "user_note";
  folderId: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  /** An ePub with bytes in the bucket — i.e. one the reader can actually open.
   *  False for ePubs uploaded before the reader existed: their file was
   *  discarded at upload and only the extracted text survives. */
  isBook: boolean;
  /** A book the reader has marked read. */
  bookFinished: boolean;
  /** 0..1. Zero for anything that is not a book, or has not been opened. */
  bookProgress: number;
  bookAuthor: string | null;
  /** False only when the ePub is KNOWN to carry no cover image. */
  bookHasCover: boolean;
  readingStatus: ReadingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type DirectoryPage = {
  items: DirItem[];
  itemTagsById: Record<string, string[]>;
  hasMore: boolean;
};

// Re-export so server-side callers can keep importing from query.ts. The
// constant itself lives in constants.ts (db-free) so client components can
// import it without dragging postgres into the client bundle.
export { DIRECTORY_PAGE_SIZE } from "./constants";

/**
 * One page of directory items (newest-updated first), scoped by folder and/or
 * tags, with their tag names. Shared by the server page (offset 0) and the
 * infinite-scroll load-more action so large libraries page instead of loading
 * everything at once. Uses limit+1 to know if more rows remain.
 */
export type DirectorySort = "updated" | "created" | "title" | "tags";

/**
 * The SQL for a row's preview snippet.
 *
 * Migration 0031 adds a stored generated `preview` column so the list never has
 * to slice `content` — which lives in TOAST for any sizeable note or document,
 * making a 50-row page pay up to fifty out-of-line fetches on a cold cache.
 *
 * But the column cannot simply be assumed. Code and migrations deploy
 * separately, and selecting a column that isn't there yet does not degrade —
 * it rejects the whole query, which took the Directory page's entire
 * `Promise.all` down with it and rendered "0 items" with no folder names. So
 * the column is used only once it has been confirmed to exist, and the old
 * expression serves until then. Same shape as the tsvector fallback in
 * `lib/ai/rag.ts`.
 *
 * Checked once per process and cached: it is a catalog lookup, and the answer
 * only ever changes when a migration runs, which restarts nothing but is
 * picked up on the next cold start.
 */
let hasPreviewColumn: boolean | null = null;

async function previewSql() {
  if (hasPreviewColumn === null) {
    try {
      const res: unknown = await db.execute(sql`
        select 1 from information_schema.columns
        where table_name = 'directory_items' and column_name = 'preview'
        limit 1
      `);
      // postgres-js hands back a bare array; PGlite (desktop) wraps it in
      // `{ rows }`. Treating the wrapper as truthy would report the column
      // present on every desktop database, migrated or not.
      const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? []);
      hasPreviewColumn = rows.length > 0;
    } catch {
      // Catalog unreadable — assume the slow-but-always-correct path.
      hasPreviewColumn = false;
    }
  }
  return hasPreviewColumn
    ? sql<string | null>`preview`
    : sql<string | null>`substring(${directoryItems.content}, 1, 240)`;
}

/**
 * The preview, except for books, which never show one.
 *
 * The list renders a snippet for notes, articles and documents and deliberately
 * does not for a book — a book is shown by its cover and its progress, and the
 * first 240 characters of a title page say nothing. Computing it anyway was
 * free-looking and wasn't: a book's `content` is ten thousand characters, which
 * Postgres stores out of line, so a folder of fifty books paid fifty
 * out-of-line reads to produce fifty strings that were then thrown away by the
 * component that received them. That is the shape of "the folder got slower
 * with every book I added".
 *
 * Guarded in SQL rather than filtered afterwards, because the cost is in the
 * reading, not the sending. Where the generated `preview` column exists this
 * changes nothing measurable — it is already cheap — and it still saves
 * shipping the bytes.
 */
function listPreviewSql(preview: ReturnType<typeof sql<string | null>>) {
  return sql<string | null>`case
    when ${documents.kind} = 'epub' and ${documents.storagePath} is not null then null
    else ${preview}
  end`;
}

export async function fetchDirectoryPage(
  userId: string,
  opts: {
    folder?: string | null;
    tagIds?: string[];
    offset?: number;
    limit?: number;
    sort?: DirectorySort;
  },
): Promise<DirectoryPage> {
  const { folder = null, tagIds = [], offset = 0, limit = 50, sort = "updated" } = opts;

  const preview = await previewSql();

  const conds = [eq(directoryItems.userId, userId)];
  if (folder === "unsorted") conds.push(isNull(directoryItems.folderId));
  else if (folder) conds.push(eq(directoryItems.folderId, folder));
  if (tagIds.length > 0) {
    // Items carrying ALL selected tags (AND semantics). Inlined as a subquery
    // so it doesn't cost a serial round-trip before the page query can start.
    conds.push(
      inArray(
        directoryItems.id,
        db
          .select({ itemId: itemTags.itemId })
          .from(itemTags)
          .where(
            and(
              eq(itemTags.userId, userId),
              eq(itemTags.itemKind, "directory_item"),
              inArray(itemTags.tagId, tagIds),
            ),
          )
          .groupBy(itemTags.itemId)
          .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`),
      ),
    );
  }

  // Sort, always with an id tiebreaker → a total order so offset paging
  // (infinite scroll) can't skip/duplicate rows sharing a sort key.
  const tagCountExpr = sql`(
    select count(*) from item_tags it
    where it.item_id = ${directoryItems.id}
      and it.item_kind = 'directory_item'
      and it.user_id = ${userId}
  )`;
  const orderBy =
    sort === "created"
      ? [desc(directoryItems.createdAt), desc(directoryItems.id)]
      : sort === "title"
        ? [asc(directoryItems.title), desc(directoryItems.id)]
        : sort === "tags"
          ? [desc(tagCountExpr), desc(directoryItems.updatedAt), desc(directoryItems.id)]
          : [desc(directoryItems.updatedAt), desc(directoryItems.id)];

  // The tag-name lookup targets exactly this page's item ids. Instead of
  // waiting for the item rows and paying a second round-trip, both queries run
  // in parallel: the tag query scopes itself with a subquery repeating the same
  // filter/order/limit (cheap and indexed; re-evaluating it costs far less than
  // a serial round-trip). Tags for the +1 sentinel row are simply unused.
  const pickedIds = db
    .select({ id: directoryItems.id })
    .from(directoryItems)
    .where(and(...conds))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const [rows, tagRows] = await Promise.all([
    db
      .select({
        id: directoryItems.id,
        title: directoryItems.title,
        preview: listPreviewSql(preview).as("preview"),
        kind: directoryItems.kind,
        folderId: directoryItems.folderId,
        sourceUrl: directoryItems.sourceUrl,
        articleId: directoryItems.articleId,
        documentId: directoryItems.documentId,
        // Joined rather than four correlated subqueries: both tables are
        // reached by primary key, so one pass gets everything the shelf needs.
        // coalesce because a left join on a row with no document yields null,
        // and the shelf wants false.
        isBook: sql<boolean>`coalesce(
          ${documents.kind} = 'epub' and ${documents.storagePath} is not null, false
        )`.as("is_book"),
        bookFinished: sql<boolean>`(${bookReadingState.finishedAt} is not null)`.as(
          "book_finished",
        ),
        bookProgress: sql<number>`coalesce(${bookReadingState.progressPct}, 0)`.as(
          "book_progress",
        ),
        bookAuthor: sql<string | null>`${documents.metadata} ->> 'author'`.as("book_author"),
        // Only an explicit `false` suppresses the cover request. A book
        // ingested before this flag was recorded has no key at all, and must
        // keep today's behaviour of trying — the point is to stop a shelf
        // firing a request per COVERLESS book, not to hide covers that exist.
        bookHasCover: sql<boolean>`coalesce(${documents.metadata} ->> 'hasCover', 'true') <> 'false'`.as(
          "book_has_cover",
        ),
        readingStatus: directoryItems.readingStatus,
        createdAt: directoryItems.createdAt,
        updatedAt: directoryItems.updatedAt,
      })
      .from(directoryItems)
      .leftJoin(documents, eq(documents.id, directoryItems.documentId))
      .leftJoin(
        bookReadingState,
        and(
          eq(bookReadingState.documentId, directoryItems.documentId),
          eq(bookReadingState.userId, directoryItems.userId),
        ),
      )
      .where(and(...conds))
      .orderBy(...orderBy)
      .limit(limit + 1) // +1 sentinel to detect more
      .offset(offset),
    db
      .select({ itemId: itemTags.itemId, name: tags.name })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, userId),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.itemId, pickedIds),
        ),
      ),
  ]);

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows) as DirItem[];

  const itemTagsById = tagRows.reduce((acc, r) => {
    (acc[r.itemId] ??= []).push(r.name);
    return acc;
  }, {} as Record<string, string[]>);

  return { items, itemTagsById, hasMore };
}

export type FolderTreeItem = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
};

/**
 * Minimal direct-child item list for one folder — just enough to render a
 * file row in the sidebar tree (VSCode-style expand). Deliberately lighter
 * than `fetchDirectoryPage` (no preview/tags/pagination): the tree only ever
 * needs a title, kind, and id per row, and is fetched lazily per folder on
 * first expand rather than for the whole tree up front.
 */
export async function fetchFolderTreeItems(
  userId: string,
  folderId: string,
  limit = 200,
): Promise<FolderTreeItem[]> {
  return db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.userId, userId), eq(directoryItems.folderId, folderId)))
    .orderBy(asc(directoryItems.title))
    .limit(limit);
}

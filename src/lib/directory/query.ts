import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, itemTags, tags } from "@/lib/db/schema";

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
        preview: sql<string | null>`substring(${directoryItems.content}, 1, 240)`.as("preview"),
        kind: directoryItems.kind,
        folderId: directoryItems.folderId,
        sourceUrl: directoryItems.sourceUrl,
        articleId: directoryItems.articleId,
        documentId: directoryItems.documentId,
        readingStatus: directoryItems.readingStatus,
        createdAt: directoryItems.createdAt,
        updatedAt: directoryItems.updatedAt,
      })
      .from(directoryItems)
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

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, itemTags, tags } from "@/lib/db/schema";

export type DirItem = {
  id: string;
  title: string;
  preview: string | null;
  kind: "saved_article" | "uploaded_document" | "user_note";
  folderId: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DirectoryPage = {
  items: DirItem[];
  itemTagsById: Record<string, string[]>;
  hasMore: boolean;
};

/** Default page size for directory infinite scroll. Shared by the server
 *  page (first paint) and the load-more action. */
export const DIRECTORY_PAGE_SIZE = 50;

/**
 * One page of directory items (newest-updated first), scoped by folder and/or
 * tags, with their tag names. Shared by the server page (offset 0) and the
 * infinite-scroll load-more action so large libraries page instead of loading
 * everything at once. Uses limit+1 to know if more rows remain.
 */
export async function fetchDirectoryPage(
  userId: string,
  opts: { folder?: string | null; tagIds?: string[]; offset?: number; limit?: number },
): Promise<DirectoryPage> {
  const { folder = null, tagIds = [], offset = 0, limit = 50 } = opts;

  // Resolve the item ids matching ALL selected tags (AND semantics).
  let tagFilteredIds: string[] | null = null;
  if (tagIds.length > 0) {
    const matched = await db
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
      .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`);
    tagFilteredIds = matched.map((m) => m.itemId);
    if (tagFilteredIds.length === 0) return { items: [], itemTagsById: {}, hasMore: false };
  }

  const conds = [eq(directoryItems.userId, userId)];
  if (folder === "unsorted") conds.push(isNull(directoryItems.folderId));
  else if (folder) conds.push(eq(directoryItems.folderId, folder));
  if (tagFilteredIds) conds.push(inArray(directoryItems.id, tagFilteredIds));

  const rows = await db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      preview: sql<string | null>`substring(${directoryItems.content}, 1, 240)`.as("preview"),
      kind: directoryItems.kind,
      folderId: directoryItems.folderId,
      sourceUrl: directoryItems.sourceUrl,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
    })
    .from(directoryItems)
    .where(and(...conds))
    .orderBy(desc(directoryItems.updatedAt))
    .limit(limit + 1) // +1 sentinel to detect more
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows) as DirItem[];

  let itemTagsById: Record<string, string[]> = {};
  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const tagRows = await db
      .select({ itemId: itemTags.itemId, name: tags.name })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, userId),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.itemId, ids),
        ),
      );
    itemTagsById = tagRows.reduce((acc, r) => {
      (acc[r.itemId] ??= []).push(r.name);
      return acc;
    }, {} as Record<string, string[]>);
  }

  return { items, itemTagsById, hasMore };
}

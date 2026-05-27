import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, itemTags, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryShell } from "@/components/directory/directory-shell";

type Search = Promise<{
  folder?: string;
  tags?: string;
  q?: string;
}>;

const ITEM_LIMIT = 200;

export default async function DirectoryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { user } = await requireUser();

  // Resolve item IDs that match the tag filter (AND semantics) if any tags selected
  let tagFilteredIds: string[] | null = null;
  const tagIds = (sp.tags ?? "").split(",").filter(Boolean);
  if (tagIds.length > 0) {
    const matched = await db
      .select({ itemId: itemTags.itemId })
      .from(itemTags)
      .where(
        and(
          eq(itemTags.userId, user.id),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.tagId, tagIds),
        ),
      )
      .groupBy(itemTags.itemId)
      .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`);
    tagFilteredIds = matched.map((m) => m.itemId);
    if (tagFilteredIds.length === 0) {
      const emptyFolders = await db
        .select()
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, user.id))
        .orderBy(asc(directoryFolders.name));
      return (
        <DirectoryShell
          items={[]}
          itemTagsById={{}}
          folders={emptyFolders}
          activeFolder={sp.folder ?? null}
          activeTagIds={tagIds}
        />
      );
    }
  }

  const conds = [eq(directoryItems.userId, user.id)];
  if (sp.folder === "unsorted") {
    conds.push(isNull(directoryItems.folderId));
  } else if (sp.folder) {
    conds.push(eq(directoryItems.folderId, sp.folder));
  }
  if (tagFilteredIds) conds.push(inArray(directoryItems.id, tagFilteredIds));

  // List view doesn't need full content — fetch only a short preview.
  // The viewer pulls full content on demand via /api/directory/:id.
  const [items, allFolders] = await Promise.all([
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
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
    })
    .from(directoryItems)
    .where(and(...conds))
    .orderBy(desc(directoryItems.updatedAt))
    .limit(ITEM_LIMIT),
    db
      .select()
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id))
      .orderBy(asc(directoryFolders.name)),
  ]);

  // Step 4: fetch tags per visible item (cheap — usually 3 tags per item),
  // rendered conditionally so empty-tag items don't get a tag row.
  let itemTagsById: Record<string, string[]> = {};
  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const rows = await db
      .select({ itemId: itemTags.itemId, name: tags.name })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, user.id),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.itemId, ids),
        ),
      );
    itemTagsById = rows.reduce((acc, r) => {
      (acc[r.itemId] ??= []).push(r.name);
      return acc;
    }, {} as Record<string, string[]>);
  }

  return (
    <DirectoryShell
      items={items}
      itemTagsById={itemTagsById}
      folders={allFolders}
      activeFolder={sp.folder ?? null}
      activeTagIds={tagIds}
    />
  );
}

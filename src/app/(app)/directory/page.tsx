import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, itemTags, tags } from "@/lib/db/schema";
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
      return (
        <DirectoryShell
          items={[]}
          itemTagsById={{}}
          activeFolder={sp.folder ?? null}
          activeTagIds={tagIds}
        />
      );
    }
  }

  const conds = [eq(directoryItems.userId, user.id)];
  if (sp.folder) conds.push(eq(directoryItems.folderId, sp.folder));
  if (tagFilteredIds) conds.push(inArray(directoryItems.id, tagFilteredIds));

  const items = await db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      content: directoryItems.content,
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
    .limit(ITEM_LIMIT);

  // Fetch tags per item — keyed map
  let itemTagsById: Record<string, string[]> = {};
  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const tagJoin = await db
      .select({
        itemId: itemTags.itemId,
        tagName: tags.name,
      })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, user.id),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.itemId, ids),
        ),
      );

    itemTagsById = tagJoin.reduce((acc, row) => {
      (acc[row.itemId] ??= []).push(row.tagName);
      return acc;
    }, {} as Record<string, string[]>);
  }

  return (
    <DirectoryShell
      items={items}
      itemTagsById={itemTagsById}
      activeFolder={sp.folder ?? null}
      activeTagIds={tagIds}
    />
  );
}

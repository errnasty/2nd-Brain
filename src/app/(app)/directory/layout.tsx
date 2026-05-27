import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  directoryFolders,
  directoryItems,
  itemTags,
  tags,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav } from "@/components/directory/directory-nav";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  const [folders, allTags, tagCounts, itemCountByFolder] = await Promise.all([
    db
      .select()
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id))
      .orderBy(asc(directoryFolders.position), asc(directoryFolders.name)),
    db.select().from(tags).where(eq(tags.userId, user.id)).orderBy(asc(tags.name)),
    db
      .select({
        tagId: itemTags.tagId,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(itemTags)
      .where(eq(itemTags.userId, user.id))
      .groupBy(itemTags.tagId),
    db
      .select({
        folderId: directoryItems.folderId,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(directoryItems)
      .where(eq(directoryItems.userId, user.id))
      .groupBy(directoryItems.folderId),
  ]);

  const tagCountMap = Object.fromEntries(tagCounts.map((t) => [t.tagId, t.count])) as Record<string, number>;
  const folderCountMap = Object.fromEntries(
    itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
  ) as Record<string, number>;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <DirectoryNav
        folders={folders}
        tags={allTags}
        tagCounts={tagCountMap}
        folderCounts={folderCountMap}
      />
      <div className="flex flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

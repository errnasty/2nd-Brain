import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, itemTags, tags, type DirectoryFolder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav, type DirectoryTag } from "@/components/directory/directory-nav";
import { DirectoryDndShell } from "@/components/directory/directory-dnd-shell";
import { ResizableShell } from "@/components/shell/resizable-shell";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  // Defensive: render the shell even if a query fails (e.g. migration pending).
  let folders: DirectoryFolder[] = [];
  let folderCountMap: Record<string, number> = {};
  let unsortedCount = 0;
  let tagList: DirectoryTag[] = [];
  try {
    const [foldersRes, itemCountByFolder, unsortedRows, tagRows] = await Promise.all([
      db
        .select()
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, user.id))
        .orderBy(asc(directoryFolders.position), asc(directoryFolders.name)),
      db
        .select({
          folderId: directoryItems.folderId,
          count: sql<number>`count(*)::int`.as("count"),
        })
        .from(directoryItems)
        .where(eq(directoryItems.userId, user.id))
        .groupBy(directoryItems.folderId),
      db
        .select({ count: sql<number>`count(*)::int`.as("count") })
        .from(directoryItems)
        .where(and(eq(directoryItems.userId, user.id), isNull(directoryItems.folderId))),
      // Tags with how many directory items carry them, most-used first.
      db
        .select({
          id: tags.id,
          name: tags.name,
          count: sql<number>`count(*)::int`.as("count"),
        })
        .from(itemTags)
        .innerJoin(tags, eq(tags.id, itemTags.tagId))
        .where(and(eq(itemTags.userId, user.id), eq(itemTags.itemKind, "directory_item")))
        .groupBy(tags.id, tags.name)
        .orderBy(desc(sql`count(*)`), asc(tags.name))
        .limit(40),
    ]);
    folders = foldersRes;
    folderCountMap = Object.fromEntries(
      itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
    ) as Record<string, number>;
    unsortedCount = unsortedRows[0]?.count ?? 0;
    tagList = tagRows;
  } catch (err) {
    console.error("DirectoryLayout data fetch failed:", err instanceof Error ? err.message : err);
  }

  return (
    <DirectoryDndShell>
      <ResizableShell
        storageId="directory-shell"
        mobileRoute="directory"
        nav={
          <DirectoryNav
            folders={folders}
            folderCounts={folderCountMap}
            unsortedCount={unsortedCount}
            tags={tagList}
          />
        }
      >
        <div className="flex h-full overflow-hidden">{children}</div>
      </ResizableShell>
    </DirectoryDndShell>
  );
}

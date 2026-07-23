import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, itemTags, tags, type DirectoryFolder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav, type DirectoryTag } from "@/components/directory/directory-nav";
import { DirectoryDndShell } from "@/components/directory/directory-dnd-shell";
import { ResizableShell } from "@/components/shell/resizable-shell";
import { getFolderCounts } from "@/lib/directory/folder-counts";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  // Defensive: render the shell even if a query fails (e.g. migration pending).
  let folders: DirectoryFolder[] = [];
  let folderCountMap: Record<string, number> = {};
  let unsortedCount = 0;
  let tagList: DirectoryTag[] = [];
  try {
    const [foldersRes, counts, tagRows] = await Promise.all([
      db
        .select()
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, user.id))
        .orderBy(asc(directoryFolders.position), asc(directoryFolders.name)),
      // Shared + request-cached with directory/page.tsx's call to the same
      // helper, so switching folders doesn't pay for this query twice.
      getFolderCounts(user.id),
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
    folderCountMap = counts.folderCountMap;
    unsortedCount = counts.unsortedCount;
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
        <div className="flex h-full min-w-0 w-full overflow-hidden">{children}</div>
      </ResizableShell>
    </DirectoryDndShell>
  );
}

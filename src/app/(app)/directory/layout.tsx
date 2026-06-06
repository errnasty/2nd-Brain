import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, type DirectoryFolder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav } from "@/components/directory/directory-nav";
import { DirectoryDndShell } from "@/components/directory/directory-dnd-shell";
import { ResizableShell } from "@/components/shell/resizable-shell";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  // Defensive: render the shell even if a query fails (e.g. migration pending).
  let folders: DirectoryFolder[] = [];
  let folderCountMap: Record<string, number> = {};
  let unsortedCount = 0;
  try {
    const [foldersRes, itemCountByFolder, unsortedRows] = await Promise.all([
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
    ]);
    folders = foldersRes;
    folderCountMap = Object.fromEntries(
      itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
    ) as Record<string, number>;
    unsortedCount = unsortedRows[0]?.count ?? 0;
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
          />
        }
      >
        <div className="flex h-full overflow-hidden">{children}</div>
      </ResizableShell>
    </DirectoryDndShell>
  );
}

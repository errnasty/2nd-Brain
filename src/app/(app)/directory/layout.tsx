import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav } from "@/components/directory/directory-nav";
import { DirectoryDndShell } from "@/components/directory/directory-dnd-shell";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  const [folders, itemCountByFolder, unsortedRows] = await Promise.all([
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

  const folderCountMap = Object.fromEntries(
    itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
  ) as Record<string, number>;

  const unsortedCount = unsortedRows[0]?.count ?? 0;

  return (
    <DirectoryDndShell>
      <div className="flex h-full w-full overflow-hidden">
        <DirectoryNav
          folders={folders}
          folderCounts={folderCountMap}
          unsortedCount={unsortedCount}
        />
        <div className="flex flex-1 overflow-hidden">{children}</div>
      </div>
    </DirectoryDndShell>
  );
}

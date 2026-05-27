import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryNav } from "@/components/directory/directory-nav";

export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  const [folders, itemCountByFolder] = await Promise.all([
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
  ]);

  const folderCountMap = Object.fromEntries(
    itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
  ) as Record<string, number>;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <DirectoryNav folders={folders} folderCounts={folderCountMap} />
      <div className="flex flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

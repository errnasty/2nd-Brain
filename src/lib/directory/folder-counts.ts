import { cache } from "react";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems } from "@/lib/db/schema";

export type FolderCounts = {
  /** Direct-child item count per folder id. */
  folderCountMap: Record<string, number>;
  unsortedCount: number;
};

/**
 * Direct-child item counts for every folder, plus the Unsorted tray count.
 * Wrapped in React's `cache()` so the layout (sidebar) and the page (content
 * pane) can both call this in the same request without paying for the query
 * twice — they're separate server components and don't otherwise share data.
 */
export const getFolderCounts = cache(async (userId: string): Promise<FolderCounts> => {
  const [itemCountByFolder, unsortedRows] = await Promise.all([
    db
      .select({
        folderId: directoryItems.folderId,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(directoryItems)
      .where(eq(directoryItems.userId, userId))
      .groupBy(directoryItems.folderId),
    db
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(directoryItems)
      .where(and(eq(directoryItems.userId, userId), isNull(directoryItems.folderId))),
  ]);
  const folderCountMap = Object.fromEntries(
    itemCountByFolder.map((f) => [f.folderId ?? "__root__", f.count]),
  ) as Record<string, number>;
  return { folderCountMap, unsortedCount: unsortedRows[0]?.count ?? 0 };
});

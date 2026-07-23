import { cache } from "react";
import { eq, sql } from "drizzle-orm";
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
 *
 * A single GROUP BY folder_id already includes a NULL-folder_id row for
 * unsorted items, so that's the unsorted count too — no need for a second
 * round-trip to re-derive it.
 */
export const getFolderCounts = cache(async (userId: string): Promise<FolderCounts> => {
  const itemCountByFolder = await db
    .select({
      folderId: directoryItems.folderId,
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(directoryItems)
    .where(eq(directoryItems.userId, userId))
    .groupBy(directoryItems.folderId);

  const folderCountMap: Record<string, number> = {};
  let unsortedCount = 0;
  for (const row of itemCountByFolder) {
    if (row.folderId === null) unsortedCount = row.count;
    else folderCountMap[row.folderId] = row.count;
  }
  return { folderCountMap, unsortedCount };
});

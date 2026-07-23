import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, type DirectoryFolder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryShell } from "@/components/directory/directory-shell";
import { getUserSettings } from "@/lib/settings/store";
import type { UserSettingsData } from "@/lib/db/schema";
import {
  DIRECTORY_PAGE_SIZE,
  fetchDirectoryPage,
  type DirectoryPage,
  type DirectorySort,
} from "@/lib/directory/query";
import { getFolderCounts } from "@/lib/directory/folder-counts";

type Search = Promise<{
  folder?: string;
  tags?: string;
  q?: string;
  sort?: string;
}>;

const SORTS: DirectorySort[] = ["updated", "created", "title", "tags"];

export default async function DirectoryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { user } = await requireUser();
  const tagIds = (sp.tags ?? "").split(",").filter(Boolean);
  const sort = (SORTS.includes(sp.sort as DirectorySort) ? sp.sort : "updated") as DirectorySort;

  // Fail soft: a pending migration (e.g. 0009's reading_status) would otherwise
  // crash the whole route. Render an empty Directory instead of white-screening.
  let page: DirectoryPage = { items: [], itemTagsById: {}, hasMore: false };
  let allFolders: DirectoryFolder[] = [];
  let settings: UserSettingsData = {};
  let folderCounts: Record<string, number> = {};
  try {
    const [pageRes, foldersRes, settingsRes, counts] = await Promise.all([
      fetchDirectoryPage(user.id, {
        folder: sp.folder ?? null,
        tagIds,
        offset: 0,
        limit: DIRECTORY_PAGE_SIZE,
        sort,
      }),
      db
        .select()
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, user.id))
        .orderBy(asc(directoryFolders.name)),
      getUserSettings(user.id),
      // Shared + request-cached with the sibling layout's call to the same
      // helper — used here for the child-folder tiles' item-count badges.
      getFolderCounts(user.id),
    ]);
    page = pageRes;
    allFolders = foldersRes;
    settings = settingsRes;
    folderCounts = counts.folderCountMap;
  } catch (err) {
    console.error("DirectoryPage data fetch failed:", err instanceof Error ? err.message : err);
  }

  return (
    <DirectoryShell
      items={page.items}
      itemTagsById={page.itemTagsById}
      hasMore={page.hasMore}
      folders={allFolders}
      folderCounts={folderCounts}
      activeFolder={sp.folder ?? null}
      activeTagIds={tagIds}
      activeSort={sort}
      wipLimits={settings.wipLimits ?? {}}
    />
  );
}

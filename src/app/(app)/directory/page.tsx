import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DirectoryShell } from "@/components/directory/directory-shell";
import { fetchDirectoryPage } from "@/lib/directory/query";

type Search = Promise<{
  folder?: string;
  tags?: string;
  q?: string;
}>;

export const PAGE_SIZE = 50;

export default async function DirectoryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { user } = await requireUser();
  const tagIds = (sp.tags ?? "").split(",").filter(Boolean);

  const [page, allFolders] = await Promise.all([
    fetchDirectoryPage(user.id, {
      folder: sp.folder ?? null,
      tagIds,
      offset: 0,
      limit: PAGE_SIZE,
    }),
    db
      .select()
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id))
      .orderBy(asc(directoryFolders.name)),
  ]);

  return (
    <DirectoryShell
      items={page.items}
      itemTagsById={page.itemTagsById}
      hasMore={page.hasMore}
      folders={allFolders}
      activeFolder={sp.folder ?? null}
      activeTagIds={tagIds}
    />
  );
}

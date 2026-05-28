import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feeds, folders, type Feed, type Folder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/rss/sync";
import { FeedsNav } from "@/components/feeds/feeds-nav";
import { UnreadTitle } from "@/components/feeds/unread-title";
import { ResizableShell } from "@/components/shell/resizable-shell";

export default async function FeedsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  // Defensive: if any of these queries fail (e.g. a migration not yet run),
  // render the shell with empty data rather than crashing the whole route.
  let foldersList: Folder[] = [];
  let feedsList: Feed[] = [];
  let unread: { perFeed: Record<string, number>; perFolder: Record<string, number> } = {
    perFeed: {},
    perFolder: {},
  };
  try {
    [foldersList, feedsList, unread] = await Promise.all([
      db.select().from(folders).where(eq(folders.userId, user.id)).orderBy(asc(folders.position), asc(folders.name)),
      db.select().from(feeds).where(eq(feeds.userId, user.id)).orderBy(asc(feeds.title)),
      getUnreadCounts(user.id),
    ]);
  } catch (err) {
    console.error("FeedsLayout data fetch failed:", err instanceof Error ? err.message : err);
  }

  const totalUnread = Object.values(unread.perFeed).reduce((a, b) => a + b, 0);

  return (
    <>
      <UnreadTitle count={totalUnread} />
      <ResizableShell
        storageId="feeds-shell"
        nav={<FeedsNav folders={foldersList} feeds={feedsList} unread={unread} />}
      >
        <div className="flex h-full overflow-hidden">{children}</div>
      </ResizableShell>
    </>
  );
}

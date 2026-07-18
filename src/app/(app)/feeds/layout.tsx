import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feeds, folders, type Folder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUnreadCountsCached } from "@/lib/rss/sync";
import { FeedsNav, type NavFeed } from "@/components/feeds/feeds-nav";
import { UnreadTitle } from "@/components/feeds/unread-title";
import { ResizableShell } from "@/components/shell/resizable-shell";

export default async function FeedsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  // Defensive: if any of these queries fail (e.g. a migration not yet run),
  // render the shell with empty data rather than crashing the whole route.
  let foldersList: Folder[] = [];
  let feedsList: NavFeed[] = [];
  let unread: { perFeed: Record<string, number>; perFolder: Record<string, number> } = {
    perFeed: {},
    perFolder: {},
  };
  try {
    [foldersList, feedsList, unread] = await Promise.all([
      db.select().from(folders).where(eq(folders.userId, user.id)).orderBy(asc(folders.position), asc(folders.name)),
      // Only the columns the nav renders — full rows drag etag/description/
      // bookkeeping fields into the RSC payload on every /feeds navigation.
      db
        .select({
          id: feeds.id,
          folderId: feeds.folderId,
          title: feeds.title,
          url: feeds.url,
          siteUrl: feeds.siteUrl,
          iconUrl: feeds.iconUrl,
          lastError: feeds.lastError,
        })
        .from(feeds)
        .where(eq(feeds.userId, user.id))
        .orderBy(asc(feeds.title)),
      getUnreadCountsCached(user.id),
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
        mobileRoute="feeds"
        nav={<FeedsNav folders={foldersList} feeds={feedsList} unread={unread} />}
      >
        <div className="flex h-full min-w-0 w-full overflow-hidden">{children}</div>
      </ResizableShell>
    </>
  );
}

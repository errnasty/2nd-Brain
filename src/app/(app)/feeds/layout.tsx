import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feeds, folders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/rss/sync";
import { FeedsNav } from "@/components/feeds/feeds-nav";

export default async function FeedsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  const [foldersList, feedsList, unread] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, user.id)).orderBy(asc(folders.position), asc(folders.name)),
    db.select().from(feeds).where(eq(feeds.userId, user.id)).orderBy(asc(feeds.title)),
    getUnreadCounts(user.id),
  ]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <FeedsNav folders={foldersList} feeds={feedsList} unread={unread} />
      <div className="flex flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

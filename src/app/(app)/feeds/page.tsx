import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { FeedsShell } from "@/components/feeds/feeds-shell";

type Search = Promise<{
  feed?: string;
  folder?: string;
  view?: "unread" | "all" | "starred";
  // `article` is intentionally NOT read here — selection lives in client state
  // (FeedsShell) so opening an article doesn't trigger a server re-render.
}>;

const ARTICLE_LIMIT = 100;

export default async function FeedsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const view = sp.view ?? "unread";
  const { user } = await requireUser();

  const where = [eq(articles.userId, user.id)];
  if (sp.feed) where.push(eq(articles.feedId, sp.feed));
  if (sp.folder) where.push(eq(articles.folderId, sp.folder));
  if (view === "unread") where.push(eq(articles.readStatus, "unread"));
  if (view === "starred") where.push(eq(articles.starred, true));

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      excerpt: articles.excerpt,
      author: articles.author,
      url: articles.url,
      publishDate: articles.publishDate,
      readStatus: articles.readStatus,
      starred: articles.starred,
      imageUrl: articles.imageUrl,
      feedTitle: feeds.title,
      feedIconUrl: feeds.iconUrl,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(...where))
    .orderBy(desc(articles.publishDate))
    .limit(ARTICLE_LIMIT);

  return (
    <FeedsShell
      items={rows}
      view={view}
      feedId={sp.feed ?? null}
      folderId={sp.folder ?? null}
      orderedIds={rows.map((r) => r.id)}
    />
  );
}

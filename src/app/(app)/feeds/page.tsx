import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, itemTags, tags } from "@/lib/db/schema";
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

  // Fetch tags per visible article. Articles aren't auto-tagged anymore,
  // so this is usually empty — but if any legacy or manually-applied tags
  // exist, render them conditionally in the list.
  let articleTagsById: Record<string, string[]> = {};
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const tagRows = await db
      .select({ itemId: itemTags.itemId, name: tags.name })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, user.id),
          eq(itemTags.itemKind, "article"),
          inArray(itemTags.itemId, ids),
        ),
      );
    articleTagsById = tagRows.reduce((acc, r) => {
      (acc[r.itemId] ??= []).push(r.name);
      return acc;
    }, {} as Record<string, string[]>);
  }

  return (
    <FeedsShell
      items={rows}
      itemTagsById={articleTagsById}
      view={view}
      feedId={sp.feed ?? null}
      folderId={sp.folder ?? null}
      orderedIds={rows.map((r) => r.id)}
    />
  );
}

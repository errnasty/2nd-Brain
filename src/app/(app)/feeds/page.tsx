import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, itemTags, storyClusters, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { FeedsShell } from "@/components/feeds/feeds-shell";
import { parseFeedSort, type FeedSort } from "@/lib/feeds/sort";

type Search = Promise<{
  feed?: string;
  folder?: string;
  view?: "unread" | "all" | "starred" | "readlater";
  sort?: FeedSort;
  // Read client-side only (ArticleList) — collapsing into stories happens
  // there, so the server render doesn't depend on it.
  dedupe?: string;
  // `article` is intentionally NOT read here — selection lives in client state
  // (FeedsShell) so opening an article doesn't trigger a server re-render.
}>;

const ARTICLE_LIMIT = 100;

export default async function FeedsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const view = sp.view ?? "unread";
  const sort: FeedSort = parseFeedSort(sp.sort);
  const { user } = await requireUser();

  const where = [eq(articles.userId, user.id)];
  if (sp.feed) where.push(eq(articles.feedId, sp.feed));
  if (sp.folder) where.push(eq(articles.folderId, sp.folder));
  if (view === "unread") where.push(eq(articles.readStatus, "unread"));
  if (view === "starred") where.push(eq(articles.starred, true));
  if (view === "readlater") where.push(eq(articles.readLater, true));
  // Trending leads with how widely a story is being covered; the publish-date
  // tie-break means an unscored database (fresh install, or the desktop app,
  // where no trending cron runs) behaves exactly like "newest".
  const orderBy =
    sort === "oldest"
      ? [asc(articles.publishDate)]
      : sort === "trending"
        ? [desc(articles.trendScore), desc(articles.publishDate)]
        : [desc(articles.publishDate)];

  // Defensive: a failed query returns an empty list instead of crashing the
  // server render. `rows` are already plain {key: value} objects selected
  // explicitly (no raw ORM prototypes), so they serialize cleanly to the
  // client component below.
  type Row = {
    id: string;
    title: string;
    excerpt: string | null;
    author: string | null;
    url: string;
    publishDate: Date | null;
    readStatus: "unread" | "read" | "archived";
    starred: boolean;
    readLater: boolean;
    wordCount: number | null;
    imageUrl: string | null;
    feedTitle: string;
    feedIconUrl: string | null;
    clusterId: string | null;
    sourceCount: number | null;
    firstSeen: Date | null;
    lastSeen: Date | null;
    externalVolume: number | null;
  };
  let rows: Row[] = [];
  let articleTagsById: Record<string, string[]> = {};
  try {
    // The tag lookup targets exactly the page's article ids. Instead of
    // waiting for the article rows and issuing a second round-trip, both
    // queries run in parallel: the tag query scopes itself with a subquery
    // that repeats the same filter/order/limit. The filter is cheap and
    // indexed, so re-evaluating it costs far less than a serial round-trip.
    const pickedIds = db
      .select({ id: articles.id })
      .from(articles)
      .where(and(...where))
      .orderBy(...orderBy, desc(articles.id))
      .limit(ARTICLE_LIMIT);

    const [articleRows, tagRows] = await Promise.all([
      db
        .select({
          id: articles.id,
          title: articles.title,
          excerpt: articles.excerpt,
          author: articles.author,
          url: articles.url,
          publishDate: articles.publishDate,
          readStatus: articles.readStatus,
          starred: articles.starred,
          readLater: articles.readLater,
          wordCount: articles.wordCount,
          imageUrl: articles.imageUrl,
          feedTitle: feeds.title,
          feedIconUrl: feeds.iconUrl,
          // The story this is one telling of, and the evidence behind its
          // placement. All null when the trending cron hasn't run — the row
          // then shows no chip at all rather than a misleading "1 source", and
          // groups on its title instead of its cluster. See
          // `src/lib/feeds/trend-reason.ts`.
          clusterId: articles.clusterId,
          sourceCount: storyClusters.sourceCount,
          firstSeen: storyClusters.firstSeen,
          lastSeen: storyClusters.lastSeen,
          externalVolume: storyClusters.externalVolume,
        })
        .from(articles)
        .innerJoin(feeds, eq(feeds.id, articles.feedId))
        .leftJoin(storyClusters, eq(storyClusters.id, articles.clusterId))
        .where(and(...where))
        // id tiebreaker → total order; MUST match loadMoreArticlesAction so the
        // infinite-scroll offsets line up (publishDate alone is nullable/non-unique).
        .orderBy(...orderBy, desc(articles.id))
        .limit(ARTICLE_LIMIT),
      // Tags per visible article. Usually empty (articles aren't auto-tagged),
      // but render legacy/manual tags conditionally if present.
      db
        .select({ itemId: itemTags.itemId, name: tags.name })
        .from(itemTags)
        .innerJoin(tags, eq(tags.id, itemTags.tagId))
        .where(
          and(
            eq(itemTags.userId, user.id),
            eq(itemTags.itemKind, "article"),
            inArray(itemTags.itemId, pickedIds),
          ),
        ),
    ]);
    rows = articleRows;

    // Collapsing duplicate coverage happens on the CLIENT now
    // (`src/lib/feeds/stories.ts`), for two reasons. It groups on the story
    // cluster the trending pass computed rather than on an exact title match,
    // and it keeps the extra tellings attached to the row instead of dropping
    // them — which is what lets the row say "3 more outlets" and expand. Doing
    // that here would also have left the infinite-scroll pages ungrouped,
    // since `loadMoreArticlesAction` never applied the old filter.

    articleTagsById = tagRows.reduce((acc, r) => {
      (acc[r.itemId] ??= []).push(r.name);
      return acc;
    }, {} as Record<string, string[]>);
  } catch (err) {
    console.error("FeedsPage data fetch failed:", err instanceof Error ? err.message : err);
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

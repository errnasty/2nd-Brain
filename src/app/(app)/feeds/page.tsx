import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, itemTags, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { FeedsShell } from "@/components/feeds/feeds-shell";

export type FeedSort = "newest" | "oldest" | "hot";

type Search = Promise<{
  feed?: string;
  folder?: string;
  view?: "unread" | "all" | "starred" | "readlater";
  sort?: FeedSort;
  dedupe?: string;
  // `article` is intentionally NOT read here — selection lives in client state
  // (FeedsShell) so opening an article doesn't trigger a server re-render.
}>;

const ARTICLE_LIMIT = 100;
const HOT_WINDOW_DAYS = 3;

/** Normalize a title for cross-feed duplicate detection. */
function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default async function FeedsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const view = sp.view ?? "unread";
  const sort: FeedSort = sp.sort ?? "newest";
  const dedupe = sp.dedupe === "1";
  const { user } = await requireUser();

  const where = [eq(articles.userId, user.id)];
  if (sp.feed) where.push(eq(articles.feedId, sp.feed));
  if (sp.folder) where.push(eq(articles.folderId, sp.folder));
  if (view === "unread") where.push(eq(articles.readStatus, "unread"));
  if (view === "starred") where.push(eq(articles.starred, true));
  if (view === "readlater") where.push(eq(articles.readLater, true));
  // "Hot" = what's buzzing now: only the last few days, newest first.
  if (sort === "hot") {
    where.push(gte(articles.publishDate, new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000)));
  }
  const orderBy = sort === "oldest" ? asc(articles.publishDate) : desc(articles.publishDate);

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
      .orderBy(orderBy, desc(articles.id))
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
        })
        .from(articles)
        .innerJoin(feeds, eq(feeds.id, articles.feedId))
        .where(and(...where))
        // id tiebreaker → total order; MUST match loadMoreArticlesAction so the
        // infinite-scroll offsets line up (publishDate alone is nullable/non-unique).
        .orderBy(orderBy, desc(articles.id))
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

    // Collapse cross-feed duplicates (same story syndicated to multiple feeds)
    // by normalized title, keeping the first (already sort-ordered) copy.
    // (Tags were fetched for pre-dedupe ids; extra entries are simply unused.)
    if (dedupe) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const key = normTitle(r.title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

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

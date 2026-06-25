"use server";

import { and, asc, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { articles, feeds, folders, itemTags, profiles, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fetchAndParseFeed } from "@/lib/rss/parser";
import { bustUnreadCounts, syncFeed, syncUserFeeds } from "@/lib/rss/sync";
import { parseOpml } from "@/lib/opml/import";
import { generateTags, tagSlug } from "@/lib/ai/tagging";
import { routeToFolder } from "@/lib/ai/routing";

const AddFeedSchema = z.object({
  url: z.string().url(),
  folderId: z.string().uuid().nullish(),
});

export type AddFeedResult =
  | { ok: true; feedId: string; inserted: number }
  | { ok: false; error: string };

export async function addFeedAction(input: { url: string; folderId?: string | null }): Promise<AddFeedResult> {
  const parsed = AddFeedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { user } = await requireUser();
  const { url, folderId } = parsed.data;

  try {
    const meta = await fetchAndParseFeed(url);

    const [inserted] = await db
      .insert(feeds)
      .values({
        userId: user.id,
        url,
        title: meta.title,
        description: meta.description,
        siteUrl: meta.siteUrl,
        iconUrl: meta.iconUrl,
        folderId: folderId ?? null,
      })
      .onConflictDoNothing({ target: [feeds.userId, feeds.url] })
      .returning({ id: feeds.id });

    if (!inserted) {
      const [existing] = await db
        .select({ id: feeds.id })
        .from(feeds)
        .where(and(eq(feeds.userId, user.id), eq(feeds.url, url)))
        .limit(1);
      if (existing) {
        const sync = await syncFeed(existing.id, user.id);
        revalidatePath("/feeds");
        return { ok: true, feedId: existing.id, inserted: sync.inserted };
      }
      return { ok: false, error: "Failed to add feed" };
    }

    const sync = await syncFeed(inserted.id, user.id);
    revalidatePath("/feeds");
    return { ok: true, feedId: inserted.id, inserted: sync.inserted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add feed" };
  }
}

export async function deleteFeedAction(feedId: string) {
  const { user } = await requireUser();
  await db.delete(feeds).where(and(eq(feeds.id, feedId), eq(feeds.userId, user.id)));
  revalidatePath("/feeds");
}

export async function syncFeedAction(feedId: string) {
  const { user } = await requireUser();
  const result = await syncFeed(feedId, user.id);
  bustUnreadCounts(user.id);
  revalidatePath("/feeds");
  return result;
}

export type SyncAllResult =
  | { ok: true; synced: number; failed: number; remaining: number }
  | { ok: false; alreadyRunning: true }
  | { ok: false; error: string };

/**
 * Sync all of the current user's feeds, batched + concurrency-limited.
 *
 * Guards against the "user smashes the button" problem with an atomic DB lock:
 * a single conditional UPDATE acquires `profiles.is_syncing`. If another sync
 * is already in flight (and started < 5 min ago), this no-ops with
 * alreadyRunning. The lock is always released in `finally`.
 */
export async function syncAllAction(): Promise<SyncAllResult> {
  const { user } = await requireUser();

  // Atomic lock acquire: only succeeds if not currently syncing, or the
  // previous sync is stale (>5 min — covers a crashed run that never cleared).
  //
  // The lock is best-effort: if the is_syncing/sync_started_at columns don't
  // exist yet (migration 0005 not run), we degrade gracefully and sync WITHOUT
  // the lock instead of crashing the whole server action. `lockHeld` tracks
  // whether we actually acquired it so `finally` only releases when needed.
  let lockHeld = false;
  try {
    const acquired = (await db.execute(sql`
      update profiles
      set is_syncing = true, sync_started_at = now()
      where id = ${user.id}
        and (is_syncing = false or sync_started_at < now() - interval '5 minutes')
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (acquired.length === 0) {
      return { ok: false, alreadyRunning: true };
    }
    lockHeld = true;
  } catch (err) {
    // Lock columns missing or DB hiccup — log and proceed without the lock.
    console.warn(
      "Sync lock unavailable, proceeding without it:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const summary = await syncUserFeeds(user.id);
    revalidatePath("/feeds");
    return {
      ok: true,
      synced: summary.ok,
      failed: summary.failed,
      remaining: Math.max(0, summary.total - summary.processed),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed" };
  } finally {
    if (lockHeld) {
      try {
        await db
          .update(profiles)
          .set({ isSyncing: false })
          .where(eq(profiles.id, user.id));
      } catch {
        // Releasing the lock is best-effort; the 5-min staleness check covers us.
      }
    }
  }
}

const MarkReadSchema = z.object({
  articleIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["read", "unread", "archived"]),
});

export async function setReadStatusAction(input: { articleIds: string[]; status: "read" | "unread" | "archived" }) {
  const parsed = MarkReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const { user } = await requireUser();
  await db
    .update(articles)
    .set({ readStatus: parsed.data.status })
    .where(and(eq(articles.userId, user.id), inArray(articles.id, parsed.data.articleIds)));
  bustUnreadCounts(user.id);
  // NOTE: intentionally no revalidatePath here — the UI already updates
  // optimistically and the unread sidebar counts can lag until the next
  // genuine navigation. This makes opening articles instant.
  return { ok: true as const };
}

export async function toggleStarredAction(articleId: string, starred: boolean) {
  const { user } = await requireUser();
  await db
    .update(articles)
    .set({ starred })
    .where(and(eq(articles.id, articleId), eq(articles.userId, user.id)));
  // Same as above — UI is already optimistic.
}

/**
 * Add/remove articles from the "Read later" queue (distinct from starred).
 * Accepts a list so it works for a single Daily-Brief save or a bulk action.
 */
export async function setReadLaterAction(input: { articleIds: string[]; readLater: boolean }) {
  if (!Array.isArray(input.articleIds) || input.articleIds.length === 0) {
    return { ok: false as const, error: "No articles" };
  }
  const { user } = await requireUser();
  await db
    .update(articles)
    .set({ readLater: input.readLater })
    .where(and(eq(articles.userId, user.id), inArray(articles.id, input.articleIds)));
  return { ok: true as const };
}

const CreateFolderSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function createFolderAction(name: string) {
  const parsed = CreateFolderSchema.safeParse({ name });
  if (!parsed.success) return { ok: false as const, error: "Folder name required" };

  const { user } = await requireUser();
  try {
    const [row] = await db
      .insert(folders)
      .values({ userId: user.id, name: parsed.data.name })
      .returning({ id: folders.id });
    revalidatePath("/feeds");
    return { ok: true as const, folderId: row.id };
  } catch {
    return { ok: false as const, error: "Folder already exists" };
  }
}

export async function moveFeedToFolderAction(feedId: string, folderId: string | null) {
  const { user } = await requireUser();
  await db
    .update(feeds)
    .set({ folderId })
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, user.id)));
  // Articles carry their own folderId (set to the feed's folder at sync time and
  // used by the folder view's filter). Without re-stamping them here, moving a
  // feed left all its existing articles under the OLD folder — the new folder
  // showed nothing. Keep them in sync with the feed's new home.
  await db
    .update(articles)
    .set({ folderId })
    .where(and(eq(articles.feedId, feedId), eq(articles.userId, user.id)));
  revalidatePath("/feeds");
}

export async function renameFeedAction(feedId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false as const, error: "Name required" };
  const { user } = await requireUser();
  await db
    .update(feeds)
    .set({ title: trimmed })
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, user.id)));
  revalidatePath("/feeds");
  return { ok: true as const };
}

export async function renameFolderAction(folderId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: "Name required" };
  const { user } = await requireUser();
  await db
    .update(folders)
    .set({ name: trimmed })
    .where(and(eq(folders.id, folderId), eq(folders.userId, user.id)));
  revalidatePath("/feeds");
  return { ok: true as const };
}

export async function deleteFolderAction(folderId: string) {
  const { user } = await requireUser();
  await db
    .update(feeds)
    .set({ folderId: null })
    .where(and(eq(feeds.folderId, folderId), eq(feeds.userId, user.id)));
  await db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, user.id)));
  revalidatePath("/feeds");
}

export async function markFolderReadAction(folderId: string) {
  const { user } = await requireUser();
  const folderFeedIds = (
    await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(and(eq(feeds.folderId, folderId), eq(feeds.userId, user.id)))
  ).map((f) => f.id);
  if (folderFeedIds.length === 0) return;
  await db
    .update(articles)
    .set({ readStatus: "read" })
    .where(and(eq(articles.userId, user.id), inArray(articles.feedId, folderFeedIds)));
  bustUnreadCounts(user.id);
  revalidatePath("/feeds");
}

// ── Mark all read for the current view (entire scope, not just visible) ──

const MarkAllReadSchema = z.object({
  view: z.enum(["unread", "all", "starred", "readlater"]),
  feedId: z.string().uuid().nullish(),
  folderId: z.string().uuid().nullish(),
});

export async function markAllReadAction(input: {
  view: "unread" | "all" | "starred" | "readlater";
  feedId?: string | null;
  folderId?: string | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = MarkAllReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { user } = await requireUser();
  const conds: SQL[] = [eq(articles.userId, user.id), eq(articles.readStatus, "unread")];

  if (parsed.data.feedId) {
    conds.push(eq(articles.feedId, parsed.data.feedId));
  } else if (parsed.data.folderId) {
    const ids = (
      await db
        .select({ id: feeds.id })
        .from(feeds)
        .where(and(eq(feeds.folderId, parsed.data.folderId), eq(feeds.userId, user.id)))
    ).map((f) => f.id);
    if (ids.length === 0) return { ok: true, count: 0 };
    conds.push(inArray(articles.feedId, ids));
  }
  if (parsed.data.view === "starred") {
    conds.push(eq(articles.starred, true));
  }
  if (parsed.data.view === "readlater") {
    conds.push(eq(articles.readLater, true));
  }

  const result = await db
    .update(articles)
    .set({ readStatus: "read" })
    .where(and(...conds))
    .returning({ id: articles.id });

  bustUnreadCounts(user.id);
  revalidatePath("/feeds");
  return { ok: true, count: result.length };
}

// ── Article search (title + excerpt, scoped to current view) ──

export type ArticleSearchResult = {
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

export async function searchArticlesAction(input: {
  query: string;
  view: "unread" | "all" | "starred" | "readlater";
  feedId?: string | null;
  folderId?: string | null;
}): Promise<ArticleSearchResult[]> {
  const q = input.query.trim();
  if (!q) return [];
  const { user } = await requireUser();

  const conds: SQL[] = [eq(articles.userId, user.id)];
  if (input.view === "starred") conds.push(eq(articles.starred, true));
  if (input.view === "readlater") conds.push(eq(articles.readLater, true));
  if (input.feedId) conds.push(eq(articles.feedId, input.feedId));
  else if (input.folderId) {
    const ids = (
      await db
        .select({ id: feeds.id })
        .from(feeds)
        .where(and(eq(feeds.folderId, input.folderId), eq(feeds.userId, user.id)))
    ).map((f) => f.id);
    if (ids.length === 0) return [];
    conds.push(inArray(articles.feedId, ids));
  }

  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const titleOrExcerpt = or(ilike(articles.title, pattern), ilike(articles.excerpt, pattern));
  if (titleOrExcerpt) conds.push(titleOrExcerpt);

  return db
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
    .where(and(...conds))
    .orderBy(desc(articles.publishDate))
    .limit(80);
}

// ── Infinite-scroll pagination ─────────────────────────────────────────
// Mirrors the initial query in feeds/page.tsx (same filters + sort) but with
// an offset, so the client can append further pages past the first 100.

const FEED_PAGE_SIZE = 100;
const HOT_WINDOW_DAYS = 3;

export async function loadMoreArticlesAction(input: {
  view: "unread" | "all" | "starred" | "readlater";
  feedId?: string | null;
  folderId?: string | null;
  sort?: "newest" | "oldest" | "hot";
  offset: number;
}): Promise<{ items: ArticleSearchResult[]; hasMore: boolean }> {
  const { user } = await requireUser();
  const sort = input.sort ?? "newest";

  const where: SQL[] = [eq(articles.userId, user.id)];
  if (input.feedId) where.push(eq(articles.feedId, input.feedId));
  if (input.folderId) where.push(eq(articles.folderId, input.folderId));
  if (input.view === "unread") where.push(eq(articles.readStatus, "unread"));
  if (input.view === "starred") where.push(eq(articles.starred, true));
  if (input.view === "readlater") where.push(eq(articles.readLater, true));
  if (sort === "hot") {
    where.push(gte(articles.publishDate, new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000)));
  }
  const orderBy = sort === "oldest" ? asc(articles.publishDate) : desc(articles.publishDate);

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
      readLater: articles.readLater,
      wordCount: articles.wordCount,
      imageUrl: articles.imageUrl,
      feedTitle: feeds.title,
      feedIconUrl: feeds.iconUrl,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(...where))
    // id tiebreaker → a TOTAL order. publishDate is nullable + non-unique, so
    // without it offset paging skips/duplicates rows at page boundaries. MUST
    // match the initial query in feeds/page.tsx for offsets to line up.
    .orderBy(orderBy, desc(articles.id))
    .limit(FEED_PAGE_SIZE)
    .offset(Math.max(0, input.offset));

  return { items: rows, hasMore: rows.length === FEED_PAGE_SIZE };
}

// ── AI auto-tagging + smart folder routing ─────────────────────────────
// Called by the article reader once full text is loaded. Idempotent — if the
// article already has tags, it just returns them without calling the LLM.

export type ProcessArticleResult = {
  ok: boolean;
  tags: string[];
  routedTo: string | null;
  alreadyProcessed: boolean;
  error?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function processArticleAction(articleId: string): Promise<ProcessArticleResult> {
  const { user } = await requireUser();

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.userId, user.id)))
    .limit(1);

  if (!article) return { ok: false, tags: [], routedTo: null, alreadyProcessed: false, error: "Not found" };

  // Already processed?
  const existingItemTags = await db
    .select({ tagId: itemTags.tagId })
    .from(itemTags)
    .where(
      and(
        eq(itemTags.itemId, articleId),
        eq(itemTags.itemKind, "article"),
        eq(itemTags.userId, user.id),
      ),
    );

  if (existingItemTags.length > 0) {
    const tagRows = await db
      .select({ name: tags.name })
      .from(tags)
      .where(
        and(
          eq(tags.userId, user.id),
          inArray(
            tags.id,
            existingItemTags.map((t) => t.tagId),
          ),
        ),
      );
    return {
      ok: true,
      tags: tagRows.map((t) => t.name),
      routedTo: null,
      alreadyProcessed: true,
    };
  }

  // Fetch existing tags + folders in parallel
  const [allUserTags, allUserFolders] = await Promise.all([
    db.select().from(tags).where(eq(tags.userId, user.id)),
    db.select().from(folders).where(eq(folders.userId, user.id)),
  ]);

  const content = article.fullText ? stripHtml(article.fullText) : (article.excerpt ?? "");

  // Tagging + routing in parallel
  const [generatedTags, routing] = await Promise.all([
    generateTags(article.title, content, allUserTags.map((t) => t.name)),
    article.folderId
      ? Promise.resolve({ folderName: null as string | null, confidence: 0 })
      : routeToFolder(
          article.title,
          article.excerpt ?? "",
          allUserFolders.filter((f) => !f.isInbox).map((f) => f.name),
        ),
  ]);

  // Persist tags — get-or-create each tag, then link to article via itemTags
  const finalTagNames: string[] = [];
  for (const name of generatedTags) {
    const slug = tagSlug(name);
    if (!slug) continue;

    let tag = allUserTags.find((t) => t.slug === slug);
    if (!tag) {
      const [inserted] = await db
        .insert(tags)
        .values({ userId: user.id, name, slug })
        .onConflictDoNothing({ target: [tags.userId, tags.slug] })
        .returning();
      if (inserted) {
        tag = inserted;
        allUserTags.push(inserted);
      } else {
        // Lost the race — fetch the existing row
        const [existing] = await db
          .select()
          .from(tags)
          .where(and(eq(tags.userId, user.id), eq(tags.slug, slug)))
          .limit(1);
        tag = existing;
      }
    }

    if (tag) {
      await db
        .insert(itemTags)
        .values({
          tagId: tag.id,
          itemKind: "article",
          itemId: articleId,
          userId: user.id,
          source: "ai",
        })
        .onConflictDoNothing();
      finalTagNames.push(tag.name);
    }
  }

  // Folder routing
  let routedTo: string | null = null;
  if (!article.folderId) {
    let targetFolderId: string | null = null;
    let targetFolderName: string | null = null;

    if (routing.folderName) {
      const match = allUserFolders.find((f) => f.name === routing.folderName);
      if (match) {
        targetFolderId = match.id;
        targetFolderName = match.name;
      }
    }

    if (!targetFolderId) {
      // Fall back to [Inbox] — create lazily if missing
      let inbox = allUserFolders.find((f) => f.isInbox);
      if (!inbox) {
        const [created] = await db
          .insert(folders)
          .values({ userId: user.id, name: "[Inbox]", isInbox: true })
          .onConflictDoNothing({ target: [folders.userId, folders.name] })
          .returning();
        inbox =
          created ??
          (
            await db
              .select()
              .from(folders)
              .where(and(eq(folders.userId, user.id), eq(folders.isInbox, true)))
              .limit(1)
          )[0];
      }
      if (inbox) {
        targetFolderId = inbox.id;
        targetFolderName = inbox.name;
      }
    }

    if (targetFolderId) {
      await db
        .update(articles)
        .set({ folderId: targetFolderId })
        .where(and(eq(articles.id, articleId), eq(articles.userId, user.id)));
      routedTo = targetFolderName;
    }
  }

  return { ok: true, tags: finalTagNames, routedTo, alreadyProcessed: false };
}

// ── Live feed discovery via Feedly's public search ──
// https://blog.feedly.com/feedly-cloud-api - the /v3/search/feeds endpoint is
// publicly callable without auth and returns ranked feed matches.

export type FeedSearchResult = {
  title: string;
  url: string;
  description: string;
  siteUrl: string | null;
  iconUrl: string | null;
  subscribers: number;
};

export async function searchFeedsAction(query: string): Promise<FeedSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const { user } = await requireUser();

  let res: Response;
  try {
    res = await fetch(
      `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=30`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const items = data.results ?? [];

  const existing = await db
    .select({ url: feeds.url })
    .from(feeds)
    .where(eq(feeds.userId, user.id));
  const followed = new Set(existing.map((f) => f.url));

  const results: FeedSearchResult[] = [];
  for (const item of items) {
    const feedId = typeof item.feedId === "string" ? item.feedId : "";
    const url = feedId.startsWith("feed/") ? feedId.slice(5) : "";
    if (!url || followed.has(url)) continue;
    results.push({
      title: typeof item.title === "string" ? item.title : "Untitled",
      url,
      description: typeof item.description === "string" ? item.description : "",
      siteUrl: typeof item.website === "string" ? item.website : null,
      iconUrl:
        (typeof item.iconUrl === "string" ? item.iconUrl : null) ??
        (typeof item.visualUrl === "string" ? item.visualUrl : null),
      subscribers: typeof item.subscribers === "number" ? item.subscribers : 0,
    });
  }
  return results;
}

export type OpmlImportResult = {
  ok: boolean;
  error?: string;
  foldersCreated: number;
  feedsAdded: number;
  feedsSkipped: number;
  feedsFailed: number;
};

/**
 * Imports an OPML file (e.g. Inoreader > Preferences > Import/Export > Export OPML).
 *
 * For each folder in the OPML: create it if it doesn't exist already.
 * For each feed: insert it (deduped on user_id + url), then schedule a sync.
 * Syncs run serially in the background so the action returns quickly with a summary.
 */
export async function importOpmlAction(formData: FormData): Promise<OpmlImportResult> {
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return { ok: false, error: "No file provided", foldersCreated: 0, feedsAdded: 0, feedsSkipped: 0, feedsFailed: 0 };
  }

  const { user } = await requireUser();
  const xml = await file.text();

  let parsed;
  try {
    parsed = parseOpml(xml);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to parse OPML",
      foldersCreated: 0, feedsAdded: 0, feedsSkipped: 0, feedsFailed: 0,
    };
  }

  // 1) Upsert folders
  const folderIds = new Map<string, string>();
  let foldersCreated = 0;
  for (const f of parsed.folders) {
    const existing = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.userId, user.id), eq(folders.name, f.name)))
      .limit(1);
    if (existing[0]) {
      folderIds.set(f.name, existing[0].id);
    } else {
      const [row] = await db
        .insert(folders)
        .values({ userId: user.id, name: f.name })
        .returning({ id: folders.id });
      folderIds.set(f.name, row.id);
      foldersCreated += 1;
    }
  }

  // 2) Insert feeds, dedup on (user_id, url)
  const insertList: { feedId: string; isNew: boolean }[] = [];
  let feedsSkipped = 0;
  const allFeeds = [
    ...parsed.rootFeeds.map((feed) => ({ feed, folderId: null as string | null })),
    ...parsed.folders.flatMap((f) =>
      f.feeds.map((feed) => ({ feed, folderId: folderIds.get(f.name) ?? null })),
    ),
  ];

  for (const { feed, folderId } of allFeeds) {
    const inserted = await db
      .insert(feeds)
      .values({
        userId: user.id,
        url: feed.url,
        title: feed.title,
        siteUrl: feed.siteUrl,
        folderId,
      })
      .onConflictDoNothing({ target: [feeds.userId, feeds.url] })
      .returning({ id: feeds.id });

    if (inserted[0]) {
      insertList.push({ feedId: inserted[0].id, isNew: true });
    } else {
      feedsSkipped += 1;
    }
  }

  // 3) Sync each new feed serially (fast first pass; cron will keep them fresh after)
  let feedsFailed = 0;
  for (const { feedId } of insertList) {
    const res = await syncFeed(feedId, user.id);
    if (res.errored) feedsFailed += 1;
  }

  revalidatePath("/feeds");
  return {
    ok: true,
    foldersCreated,
    feedsAdded: insertList.length,
    feedsSkipped,
    feedsFailed,
  };
}

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { articles, feeds, folders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fetchAndParseFeed } from "@/lib/rss/parser";
import { syncFeed } from "@/lib/rss/sync";
import { parseOpml } from "@/lib/opml/import";

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
  revalidatePath("/feeds");
  return result;
}

export async function syncAllAction() {
  const { user } = await requireUser();
  const userFeeds = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(eq(feeds.userId, user.id));

  for (const f of userFeeds) {
    await syncFeed(f.id, user.id);
  }
  revalidatePath("/feeds");
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
  revalidatePath("/feeds");
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

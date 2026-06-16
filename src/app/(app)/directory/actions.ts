"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  articles,
  directoryFolders,
  directoryItems,
  documentChunks,
  documents,
  itemTags,
  tags,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { generateTags, tagSlug } from "@/lib/ai/tagging";
import { routeToFolder } from "@/lib/ai/routing";
import { organizeItems, type OrganizeItem } from "@/lib/ai/organize";
import { detectKind, extractByKind } from "@/lib/documents/extract";
import { chunkText } from "@/lib/documents/chunker";
import { embedNote, embedDocument } from "@/lib/embeddings/backfill";
import { syncWikilinks } from "@/lib/directory/wikilinks";
import { syncDirectoryTasks } from "@/lib/tasks/sync";
import { bustMapCache } from "@/lib/map-cache";
import { fetchDirectoryPage, type DirectoryPage, type DirItem } from "@/lib/directory/query";

/** Infinite-scroll: fetch the next page of directory items for the shell. */
export async function loadMoreDirectoryItemsAction(input: {
  folder: string | null;
  tagIds: string[];
  offset: number;
  limit: number;
}): Promise<DirectoryPage> {
  const { user } = await requireUser();
  return fetchDirectoryPage(user.id, {
    folder: input.folder,
    tagIds: input.tagIds,
    offset: input.offset,
    limit: input.limit,
  });
}

/**
 * Fetch a single directory item by id (same shape as a list row). Used to open
 * an item linked from elsewhere (e.g. a Task's "open source") that may not be on
 * the Directory's currently-loaded page/filter — without it the viewer would
 * close because the item isn't in the in-memory list.
 */
export async function fetchDirectoryItemByIdAction(itemId: string): Promise<DirItem | null> {
  const { user } = await requireUser();
  const [row] = await db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      preview: sql<string | null>`substring(${directoryItems.content}, 1, 240)`.as("preview"),
      kind: directoryItems.kind,
      folderId: directoryItems.folderId,
      sourceUrl: directoryItems.sourceUrl,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
      readingStatus: directoryItems.readingStatus,
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, itemId), eq(directoryItems.userId, user.id)))
    .limit(1);
  return (row as DirItem) ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Auto-tag any directory item. Idempotent — items already tagged are not re-tagged.
 * Called inline after item creation; safe to call again later for re-processing.
 */
async function autoTagDirectoryItem(userId: string, itemId: string) {
  // Select explicit columns (NOT select()/all) so this never references the
  // pgvector `embedding` column — which may not exist if a migration is
  // pending. Tagging doesn't need the vector anyway.
  const [item] = await db
    .select({
      id: directoryItems.id,
      kind: directoryItems.kind,
      title: directoryItems.title,
      content: directoryItems.content,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, itemId), eq(directoryItems.userId, userId)))
    .limit(1);
  if (!item) return [];

  // Already tagged?
  const existing = await db
    .select({ tagId: itemTags.tagId })
    .from(itemTags)
    .where(
      and(
        eq(itemTags.itemId, itemId),
        eq(itemTags.itemKind, "directory_item"),
        eq(itemTags.userId, userId),
      ),
    );
  if (existing.length > 0) {
    const rows = await db
      .select({ name: tags.name })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, existing.map((t) => t.tagId))));
    return rows.map((r) => r.name);
  }

  // Build text for tagging: title + content (or stripped HTML for articles/docs)
  let body = item.content ?? "";
  if (item.kind === "saved_article" && item.articleId) {
    const [art] = await db
      .select({ excerpt: articles.excerpt, fullText: articles.fullText })
      .from(articles)
      .where(eq(articles.id, item.articleId))
      .limit(1);
    if (art) body = art.fullText ? stripHtml(art.fullText) : art.excerpt ?? "";
  } else if (item.kind === "uploaded_document" && item.documentId) {
    const [doc] = await db
      .select({ fullText: documents.fullText })
      .from(documents)
      .where(eq(documents.id, item.documentId))
      .limit(1);
    if (doc?.fullText) body = doc.fullText;
  }

  const allUserTags = await db.select().from(tags).where(eq(tags.userId, userId));
  const generated = await generateTags(item.title, body, allUserTags.map((t) => t.name));
  if (generated.length === 0) return [];

  const persisted: string[] = [];
  for (const name of generated) {
    const slug = tagSlug(name);
    if (!slug) continue;
    let tag = allUserTags.find((t) => t.slug === slug);
    if (!tag) {
      const [inserted] = await db
        .insert(tags)
        .values({ userId, name, slug })
        .onConflictDoNothing({ target: [tags.userId, tags.slug] })
        .returning();
      if (inserted) {
        tag = inserted;
        allUserTags.push(inserted);
      } else {
        const [existingRow] = await db
          .select()
          .from(tags)
          .where(and(eq(tags.userId, userId), eq(tags.slug, slug)))
          .limit(1);
        tag = existingRow;
      }
    }
    if (!tag) continue;
    await db
      .insert(itemTags)
      .values({
        tagId: tag.id,
        itemKind: "directory_item",
        itemId: itemId,
        userId,
        source: "ai",
      })
      .onConflictDoNothing();
    persisted.push(tag.name);
  }
  return persisted;
}

// ── Folder CRUD ──────────────────────────────────────────────────────

const FolderNameSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function createDirectoryFolderAction(name: string, parentId?: string | null) {
  const parsed = FolderNameSchema.safeParse({ name });
  if (!parsed.success) return { ok: false as const, error: "Name required" };
  const { user } = await requireUser();
  try {
    // Validate the parent belongs to this user (nesting under another folder).
    let parent: string | null = null;
    if (parentId) {
      const [p] = await db
        .select({ id: directoryFolders.id })
        .from(directoryFolders)
        .where(and(eq(directoryFolders.id, parentId), eq(directoryFolders.userId, user.id)))
        .limit(1);
      if (!p) return { ok: false as const, error: "Parent folder not found" };
      parent = p.id;
    }
    const [row] = await db
      .insert(directoryFolders)
      .values({ userId: user.id, name: parsed.data.name, parentId: parent })
      .returning({ id: directoryFolders.id });
    bustMapCache(user.id);
    revalidatePath("/directory");
    return { ok: true as const, folderId: row.id };
  } catch {
    return { ok: false as const, error: "Folder already exists" };
  }
}

/**
 * Move a directory folder to be a child of another folder (or root if
 * parentId is null). Refuses moves that would create a cycle.
 */
export async function moveDirectoryFolderToParentAction(
  folderId: string,
  parentId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (folderId === parentId) return { ok: false, error: "Can't drop a folder onto itself" };
  const { user } = await requireUser();

  if (parentId) {
    // Walk up from the target parent. If we hit `folderId`, we'd be making a
    // cycle (dropping a folder into one of its own descendants).
    const all = await db
      .select({ id: directoryFolders.id, parentId: directoryFolders.parentId })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id));
    const byId = new Map(all.map((f) => [f.id, f]));
    let cursor: { id: string; parentId: string | null } | undefined = byId.get(parentId);
    let safety = 0;
    while (cursor && safety < 32) {
      if (cursor.id === folderId) {
        return { ok: false, error: "Can't drop a folder into its own subtree" };
      }
      if (!cursor.parentId) break;
      cursor = byId.get(cursor.parentId);
      safety += 1;
    }
  }

  await db
    .update(directoryFolders)
    .set({ parentId })
    .where(and(eq(directoryFolders.id, folderId), eq(directoryFolders.userId, user.id)));
  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true };
}

export async function renameDirectoryFolderAction(folderId: string, name: string) {
  const parsed = FolderNameSchema.safeParse({ name });
  if (!parsed.success) return { ok: false as const, error: "Name required" };
  const { user } = await requireUser();
  await db
    .update(directoryFolders)
    .set({ name: parsed.data.name })
    .where(and(eq(directoryFolders.id, folderId), eq(directoryFolders.userId, user.id)));
  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true as const };
}

/**
 * Delete a Directory folder.
 *  - mode = "unassign" (default): items inside become Unsorted (folder_id = null)
 *  - mode = "cascade":            items inside are also deleted, along with
 *                                 their polymorphic item_tags links
 */
export async function deleteDirectoryFolderAction(
  folderId: string,
  mode: "unassign" | "cascade" = "unassign",
) {
  const { user } = await requireUser();

  if (mode === "cascade") {
    const inFolder = await db
      .select({ id: directoryItems.id })
      .from(directoryItems)
      .where(and(eq(directoryItems.folderId, folderId), eq(directoryItems.userId, user.id)));
    if (inFolder.length > 0) {
      const ids = inFolder.map((r) => r.id);
      await db
        .delete(itemTags)
        .where(
          and(
            eq(itemTags.userId, user.id),
            eq(itemTags.itemKind, "directory_item"),
            inArray(itemTags.itemId, ids),
          ),
        );
      await db
        .delete(directoryItems)
        .where(and(eq(directoryItems.userId, user.id), inArray(directoryItems.id, ids)));
    }
  } else {
    await db
      .update(directoryItems)
      .set({ folderId: null })
      .where(and(eq(directoryItems.folderId, folderId), eq(directoryItems.userId, user.id)));
  }

  await db
    .delete(directoryFolders)
    .where(and(eq(directoryFolders.id, folderId), eq(directoryFolders.userId, user.id)));
  bustMapCache(user.id);
  revalidatePath("/directory");
}

// ── Note CRUD ────────────────────────────────────────────────────────

const NoteSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().max(200_000).optional(),
  folderId: z.string().uuid().nullish(),
});

export async function createNoteAction(input: { title: string; content?: string; folderId?: string | null }) {
  const parsed = NoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { user } = await requireUser();
  const [row] = await db
    .insert(directoryItems)
    .values({
      userId: user.id,
      folderId: parsed.data.folderId ?? null,
      kind: "user_note",
      title: parsed.data.title,
      content: parsed.data.content ?? "",
      updatedAt: new Date(),
    })
    .returning({ id: directoryItems.id });

  // Notes are NOT auto-tagged — the user controls their own taxonomy here.
  // Use the manual "Tag with AI" action on a note to trigger tagging on demand.
  // Embed the note in the background so Ask can find it (no await).
  void embedNote(row.id, user.id, parsed.data.title, parsed.data.content ?? null);
  void syncWikilinks(user.id, row.id, parsed.data.content ?? null);
  // AWAIT (not void): on the serverless study-plan route the function freezes
  // once it returns, so a floating task-sync would be dropped — leaving the
  // note's checkbox tasks out of the Study tab / calendar.
  await syncDirectoryTasks(user.id, row.id, parsed.data.content ?? null);

  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true as const, itemId: row.id };
}

const UpdateNoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  // Generous cap: also used for editing uploaded-document full text.
  content: z.string().max(2_000_000).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export async function updateNoteAction(input: {
  id: string;
  title?: string;
  content?: string;
  folderId?: string | null;
}) {
  const parsed = UpdateNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { user } = await requireUser();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;
  if (parsed.data.folderId !== undefined) patch.folderId = parsed.data.folderId;
  // If the note text changed, clear the embedding so the next backfill (or
  // embedNote below) re-embeds the new content. Stale embeddings would make
  // Ask retrieve based on outdated text.
  if (parsed.data.title !== undefined || parsed.data.content !== undefined) {
    patch.embedding = null;
  }
  await db
    .update(directoryItems)
    .set(patch)
    .where(and(eq(directoryItems.id, parsed.data.id), eq(directoryItems.userId, user.id)));

  const contentChanged = parsed.data.content !== undefined;
  if (parsed.data.title !== undefined || contentChanged) {
    const [row] = await db
      .select({
        kind: directoryItems.kind,
        title: directoryItems.title,
        content: directoryItems.content,
        documentId: directoryItems.documentId,
      })
      .from(directoryItems)
      .where(and(eq(directoryItems.id, parsed.data.id), eq(directoryItems.userId, user.id)))
      .limit(1);

    // Re-derive wikilinks + tasks from the new text (notes + docs).
    if (contentChanged) {
      void syncWikilinks(user.id, parsed.data.id, parsed.data.content ?? null);
      // Await so the Study tab / calendar reflect the edit before we return.
      await syncDirectoryTasks(user.id, parsed.data.id, parsed.data.content ?? null);
    }

    if (row?.kind === "user_note") {
      // Notes: embedding lives on the directory_items row; re-embed inline.
      void embedNote(parsed.data.id, user.id, row.title, row.content);
    } else if (row?.kind === "uploaded_document" && contentChanged && row.documentId) {
      // Documents: the searchable text is the underlying document + its chunks.
      // Update full_text, re-chunk, and reset chunk embeddings so the next
      // backfill re-embeds the edited text (Ask reflects the edit).
      const newText = parsed.data.content ?? "";
      await db
        .update(documents)
        .set({ fullText: newText })
        .where(and(eq(documents.id, row.documentId), eq(documents.userId, user.id)));
      await db.delete(documentChunks).where(eq(documentChunks.documentId, row.documentId));
      const chunks = chunkText(newText);
      if (chunks.length > 0) {
        await db.insert(documentChunks).values(
          chunks.map((c) => ({
            documentId: row.documentId!,
            userId: user.id,
            chunkIndex: c.index,
            content: c.text,
            tokenCount: c.approxTokens,
          })),
        );
      }
      // Re-embed the edited doc inline so Ask reflects the change immediately.
      void embedDocument(row.documentId, user.id);
    }
  }

  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true as const };
}

export async function deleteDirectoryItemAction(itemId: string) {
  const { user } = await requireUser();
  // Clean up item_tags first (CASCADE doesn't apply for polymorphic FK)
  await db
    .delete(itemTags)
    .where(
      and(
        eq(itemTags.itemId, itemId),
        eq(itemTags.itemKind, "directory_item"),
        eq(itemTags.userId, user.id),
      ),
    );
  await db
    .delete(directoryItems)
    .where(and(eq(directoryItems.id, itemId), eq(directoryItems.userId, user.id)));
  bustMapCache(user.id);
  revalidatePath("/directory");
}

// ── Bulk actions on directory items ──────────────────────────────────

export async function bulkDeleteDirectoryItemsAction(itemIds: string[]) {
  const { user } = await requireUser();
  if (itemIds.length === 0) return { ok: true as const, count: 0 };
  await db
    .delete(itemTags)
    .where(
      and(
        eq(itemTags.userId, user.id),
        eq(itemTags.itemKind, "directory_item"),
        inArray(itemTags.itemId, itemIds),
      ),
    );
  const result = await db
    .delete(directoryItems)
    .where(and(eq(directoryItems.userId, user.id), inArray(directoryItems.id, itemIds)))
    .returning({ id: directoryItems.id });
  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true as const, count: result.length };
}

export async function bulkMoveDirectoryItemsAction(itemIds: string[], folderId: string | null) {
  const { user } = await requireUser();
  if (itemIds.length === 0) return { ok: true as const, count: 0 };
  const result = await db
    .update(directoryItems)
    .set({ folderId, updatedAt: new Date() })
    .where(and(eq(directoryItems.userId, user.id), inArray(directoryItems.id, itemIds)))
    .returning({ id: directoryItems.id });
  bustMapCache(user.id);
  revalidatePath("/directory");
  return { ok: true as const, count: result.length };
}

// ── Reading pipeline (Kanban) ────────────────────────────────────────

const READING_STATUSES = ["inbox", "reading", "done", "review"] as const;
const ReadingStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(READING_STATUSES),
});

/** Move a Directory item to a reading-pipeline column. */
export async function updateReadingStatusAction(input: {
  id: string;
  status: (typeof READING_STATUSES)[number];
}) {
  const parsed = ReadingStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid status" };
  const { user } = await requireUser();
  await db
    .update(directoryItems)
    // Bump updatedAt so the card floats to the top of its new column
    // (columns auto-sort by recency).
    .set({ readingStatus: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(directoryItems.id, parsed.data.id), eq(directoryItems.userId, user.id)));
  revalidatePath("/directory");
  return { ok: true as const };
}

// ── Save an article to the Directory ────────────────────────────────

export async function saveArticleToDirectoryAction(articleId: string, folderId?: string | null) {
  const { user } = await requireUser();
  try {
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.userId, user.id)))
      .limit(1);
    if (!article) return { ok: false as const, error: "Article not found" };

    // Dedup: if this article was already saved, return that id
    const [existing] = await db
      .select({ id: directoryItems.id })
      .from(directoryItems)
      .where(
        and(
          eq(directoryItems.userId, user.id),
          eq(directoryItems.articleId, articleId),
          eq(directoryItems.kind, "saved_article"),
        ),
      )
      .limit(1);
    if (existing) return { ok: true as const, itemId: existing.id, alreadySaved: true };

    const [row] = await db
      .insert(directoryItems)
      .values({
        userId: user.id,
        folderId: folderId ?? null,
        kind: "saved_article",
        title: article.title,
        sourceUrl: article.url,
        articleId: article.id,
        updatedAt: new Date(),
      })
      .returning({ id: directoryItems.id });

    // Best-effort tagging — already self-contained, but await+catch so a
    // rejection can't become an unhandled promise on serverless.
    try {
      await autoTagDirectoryItem(user.id, row.id);
    } catch (err) {
      console.warn("autoTag after save failed:", err instanceof Error ? err.message : err);
    }

    bustMapCache(user.id);
  revalidatePath("/directory");
    return { ok: true as const, itemId: row.id, alreadySaved: false };
  } catch (err) {
    console.error("saveArticleToDirectory failed:", err instanceof Error ? err.message : err);
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to save article",
    };
  }
}

// ── Upload a file as a directory item ────────────────────────────────

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type DirectoryUploadResult =
  | { ok: true; itemId: string; chunkCount: number }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadToDirectoryAction(formData: FormData): Promise<DirectoryUploadResult> {
  const file = formData.get("file");
  const rawFolder = (formData.get("folderId") as string | null) || null;
  // Only accept a real uuid; the "unsorted" view sentinel (or any junk) → null.
  const folderId = rawFolder && UUID_RE.test(rawFolder) ? rawFolder : null;

  if (!file || !(file instanceof File)) return { ok: false, error: "No file provided" };
  if (file.size > MAX_UPLOAD_BYTES)
    return { ok: false, error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` };

  const kind = detectKind(file.name, file.type);
  if (!kind) return { ok: false, error: "Unsupported file type. Allowed: .pdf, .md, .txt, .epub" };

  const { user } = await requireUser();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, pageCount } = await extractByKind(kind, buffer);
    if (!text || text.trim().length === 0)
      return { ok: false, error: "No text could be extracted from this file" };

    const title = file.name.replace(/\.[^.]+$/, "");

    // 1) Underlying document row (file storage layer)
    const [doc] = await db
      .insert(documents)
      .values({
        userId: user.id,
        folderId: null,
        title,
        kind,
        sizeBytes: file.size,
        pageCount,
        fullText: text,
        metadata: { originalName: file.name, mimeType: file.type },
      })
      .returning({ id: documents.id });

    // 2) Chunks for embeddings (Phase 4 backfill embeds them later)
    const chunks = chunkText(text);
    if (chunks.length > 0) {
      await db.insert(documentChunks).values(
        chunks.map((c) => ({
          documentId: doc.id,
          userId: user.id,
          chunkIndex: c.index,
          content: c.text,
          tokenCount: c.approxTokens,
        })),
      );
    }

    // 3) Directory item that references the document
    const itemContent = text.length > 10_000 ? text.slice(0, 10_000) : text;
    const [item] = await db
      .insert(directoryItems)
      .values({
        userId: user.id,
        folderId,
        kind: "uploaded_document",
        title,
        documentId: doc.id,
        sourceUrl: null,
        content: itemContent,
        metadata: { originalName: file.name, mimeType: file.type, sizeBytes: file.size },
        updatedAt: new Date(),
      })
      .returning({ id: directoryItems.id });

    // Materialize any markdown checkbox tasks (e.g. an uploaded study plan with
    // `- [ ] … (due: YYYY-MM-DD)` lines) into the Study tab / calendar. Parse
    // from the FULL text (not the 10k preview) so line indices match
    // documents.full_text — that's what toggleTaskAction flips for documents,
    // and it captures tasks past the preview cutoff.
    await syncDirectoryTasks(user.id, item.id, text);

    void autoTagDirectoryItem(user.id, item.id);
    // Embed inline so the doc is answerable in Ask right away (no manual
    // Refresh Memory needed for typical-size uploads).
    void embedDocument(doc.id, user.id);

    bustMapCache(user.id);
  revalidatePath("/directory");
    return { ok: true, itemId: item.id, chunkCount: chunks.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed" };
  }
}

// ── Auto-Organize ───────────────────────────────────────────────────
// Routes every directory_item with folder_id IS NULL into the best-matching
// directory_folder via Claude. Anything without a confident match goes to
// the [Inbox] folder (lazily created).

export type OrganizeResult = {
  ok: true;
  routed: number;
  total: number;
  foldersCreated: string[];
};

/**
 * Smart Auto-Organize.
 *
 * One Claude call (Haiku) that sees ALL uncategorized items at once plus the
 * user's existing folder list, then returns commands:
 *   - `assign`        — place an existing item into an existing folder
 *   - `create_folder` — create a NEW folder for a cluster of items sharing a
 *                       distinct topic that no existing folder covers
 *
 * Steps:
 *   1. Run Claude once on the full batch.
 *   2. Execute `create_folder` commands first (so the folder rows exist).
 *   3. Resolve assign + create_folder destinations, then update items in batch.
 *   4. Items the model didn't return commands for are simply left unsorted.
 */
export async function autoOrganizeDirectoryAction(): Promise<OrganizeResult> {
  const { user } = await requireUser();

  const [unsorted, allFolders] = await Promise.all([
    db
      .select({
        id: directoryItems.id,
        title: directoryItems.title,
        kind: directoryItems.kind,
        // Truncated preview only — keeps the prompt cheap
        preview: sql<string | null>`substring(${directoryItems.content}, 1, 400)`.as("preview"),
      })
      .from(directoryItems)
      .where(and(eq(directoryItems.userId, user.id), sql`${directoryItems.folderId} is null`))
      .limit(80),
    db.select().from(directoryFolders).where(eq(directoryFolders.userId, user.id)),
  ]);

  if (unsorted.length === 0)
    return { ok: true, routed: 0, total: 0, foldersCreated: [] };

  const existingFolderNames = allFolders.filter((f) => !f.isInbox).map((f) => f.name);

  const aiItems: OrganizeItem[] = unsorted.map((u) => ({
    id: u.id,
    title: u.title,
    preview: u.preview ?? "",
    kind: u.kind,
  }));

  const commands = await organizeItems(aiItems, existingFolderNames);

  // ── 1. Create any new folders the model requested ──────────────────
  const folderNameToId = new Map<string, string>();
  for (const f of allFolders) folderNameToId.set(f.name, f.id);

  const foldersCreated: string[] = [];
  for (const cmd of commands) {
    if (cmd.action !== "create_folder") continue;
    if (folderNameToId.has(cmd.folderName)) continue; // race / dup
    try {
      const [created] = await db
        .insert(directoryFolders)
        .values({ userId: user.id, name: cmd.folderName })
        .onConflictDoNothing({ target: [directoryFolders.userId, directoryFolders.name] })
        .returning();
      if (created) {
        folderNameToId.set(cmd.folderName, created.id);
        foldersCreated.push(cmd.folderName);
      } else {
        // Folder already existed under that name — fetch it
        const [existing] = await db
          .select()
          .from(directoryFolders)
          .where(
            and(eq(directoryFolders.userId, user.id), eq(directoryFolders.name, cmd.folderName)),
          )
          .limit(1);
        if (existing) folderNameToId.set(existing.name, existing.id);
      }
    } catch {
      // ignore individual folder creation failures
    }
  }

  // ── 2. Build the itemId → folderId routing map ─────────────────────
  const validIds = new Set(unsorted.map((u) => u.id));
  const itemToFolder = new Map<string, string>();

  for (const cmd of commands) {
    if (cmd.action === "assign") {
      const folderId = folderNameToId.get(cmd.folderName);
      if (folderId && validIds.has(cmd.itemId)) {
        itemToFolder.set(cmd.itemId, folderId);
      }
    } else if (cmd.action === "create_folder") {
      const folderId = folderNameToId.get(cmd.folderName);
      if (!folderId) continue;
      for (const itemId of cmd.itemIds) {
        if (validIds.has(itemId)) itemToFolder.set(itemId, folderId);
      }
    }
  }

  // ── 3. Apply the routing — one UPDATE per destination folder ──────
  const byDest = new Map<string, string[]>();
  for (const [itemId, folderId] of itemToFolder) {
    const list = byDest.get(folderId) ?? [];
    list.push(itemId);
    byDest.set(folderId, list);
  }

  for (const [folderId, itemIds] of byDest) {
    await db
      .update(directoryItems)
      .set({ folderId })
      .where(and(eq(directoryItems.userId, user.id), inArray(directoryItems.id, itemIds)));
  }

  bustMapCache(user.id);
  revalidatePath("/directory");
  return {
    ok: true,
    routed: itemToFolder.size,
    total: unsorted.length,
    foldersCreated,
  };
}

// ── Tag filtering ────────────────────────────────────────────────────

export async function getDirectoryItemsByTagsAction(tagIds: string[]) {
  const { user } = await requireUser();
  if (tagIds.length === 0) return [];

  // Items that match ALL of the selected tag ids (AND semantics): group by
  // itemId and require the matched-tag count to equal the requested count.
  const matchedRows = await db
    .select({ itemId: itemTags.itemId })
    .from(itemTags)
    .where(
      and(
        eq(itemTags.userId, user.id),
        eq(itemTags.itemKind, "directory_item"),
        inArray(itemTags.tagId, tagIds),
      ),
    )
    .groupBy(itemTags.itemId)
    .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`);

  if (matchedRows.length === 0) return [];
  const ids = matchedRows.map((r) => r.itemId);

  return db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
      folderId: directoryItems.folderId,
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.userId, user.id), inArray(directoryItems.id, ids)))
    .orderBy(desc(directoryItems.updatedAt))
    .limit(200);
}

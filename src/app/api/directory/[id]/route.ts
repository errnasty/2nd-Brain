import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  bookChapters,
  bookReadingState,
  directoryFolders,
  directoryItems,
  documents,
  itemTags,
  tags,
} from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { getOutgoingLinks, getBacklinks } from "@/lib/directory/wikilinks";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [row] = await db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
      content: directoryItems.content,
      sourceUrl: directoryItems.sourceUrl,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
      folderId: directoryItems.folderId,
      metadata: directoryItems.metadata,
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
      docKind: documents.kind,
      docStoragePath: documents.storagePath,
      docFullText: documents.fullText,
      docPageCount: documents.pageCount,
      docSizeBytes: documents.sizeBytes,
      docMetadata: documents.metadata,
    })
    .from(directoryItems)
    .leftJoin(documents, eq(documents.id, directoryItems.documentId))
    .where(and(eq(directoryItems.id, id), eq(directoryItems.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build a folder breadcrumb by walking up parent_id. Capped at 8 hops to
  // protect against accidental cycles.
  const breadcrumb: { id: string; name: string }[] = [];
  if (row.folderId) {
    const allFolders = await db
      .select({
        id: directoryFolders.id,
        name: directoryFolders.name,
        parentId: directoryFolders.parentId,
      })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id));
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    let cur = byId.get(row.folderId) ?? null;
    let safety = 0;
    while (cur && safety < 8) {
      breadcrumb.unshift({ id: cur.id, name: cur.name });
      if (!cur.parentId) break;
      cur = byId.get(cur.parentId) ?? null;
      safety += 1;
    }
  }

  // Assigned tag names for the inspector drawer.
  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(
      and(
        eq(itemTags.userId, user.id),
        eq(itemTags.itemKind, "directory_item"),
        eq(itemTags.itemId, id),
      ),
    );

  // Wikilinks: outgoing ([[Title]] in this item's text, resolved) + backlinks.
  const [outgoingLinks, backlinks] = await Promise.all([
    getOutgoingLinks(user.id, row.content),
    getBacklinks(user.id, id),
  ]);

  // Pinned "Essence" (distilled TL;DR + key points), if it exists in metadata.
  const summary =
    (row.metadata as { summary?: { tldr: string; keyPoints: string[]; at: string } } | null)
      ?.summary ?? null;

  const isBook = row.docKind === "epub" && !!row.docStoragePath;

  // Everything the detail view shows *about* a book, rather than of it.
  let book: {
    author: string | null;
    publisher: string | null;
    language: string | null;
    chapterCount: number;
    sizeBytes: number | null;
    hasCover: boolean;
    fixedLayout: boolean;
    progressPct: number;
    chapterIdx: number;
    chapterTitle: string | null;
    started: boolean;
  } | null = null;

  if (isBook && row.documentId) {
    const meta = (row.docMetadata ?? {}) as Record<string, unknown>;
    const [state] = await db
      .select({
        progressPct: bookReadingState.progressPct,
        chapterIdx: bookReadingState.chapterIdx,
        charOffset: bookReadingState.charOffset,
      })
      .from(bookReadingState)
      .where(
        and(
          eq(bookReadingState.documentId, row.documentId),
          eq(bookReadingState.userId, user.id),
        ),
      )
      .limit(1);

    const chapterIdx = state?.chapterIdx ?? 0;
    const [chapter] = await db
      .select({ title: bookChapters.title })
      .from(bookChapters)
      .where(
        and(
          eq(bookChapters.documentId, row.documentId),
          eq(bookChapters.userId, user.id),
          eq(bookChapters.idx, chapterIdx),
        ),
      )
      .limit(1);

    book = {
      author: typeof meta.author === "string" ? meta.author : null,
      publisher: typeof meta.publisher === "string" ? meta.publisher : null,
      language: typeof meta.language === "string" ? meta.language : null,
      chapterCount: row.docPageCount ?? 0,
      sizeBytes: row.docSizeBytes ?? null,
      hasCover: meta.hasCover === true,
      fixedLayout: meta.fixedLayout === true,
      progressPct: state?.progressPct ?? 0,
      chapterIdx,
      chapterTitle: chapter?.title ?? null,
      // "Continue" only once there is somewhere to continue from.
      started: !!state && (state.chapterIdx > 0 || state.charOffset > 0),
    };
  }

  // First lines of the real body, resolved by kind (note content / doc full_text /
  // saved-article body) — so the map detail panel always shows a text preview,
  // not just for notes (saved_article rows carry no directory_items.content).
  //
  // Skipped for a book: the resolver reassembles it from its chunks, and the
  // detail view shows information about the book rather than any of its text.
  const resolved = isBook ? null : await getDirectoryItemStudyText(user.id, id);
  const preview = (resolved?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null;

  const {
    metadata: _metadata,
    docStoragePath,
    docPageCount: _docPageCount,
    docSizeBytes: _docSizeBytes,
    docMetadata: _docMetadata,
    ...rest
  } = row;

  return NextResponse.json({
    ...rest,
    // A book's body belongs in the reader. full_text for a book runs to
    // megabytes, and shipping it here so the detail view can decline to render
    // it would be the most expensive thing this route does.
    docFullText: isBook ? null : rest.docFullText,
    book,
    // An ePub with bytes in the bucket can be opened in the reader. One
    // uploaded before the reader existed cannot — its file was discarded.
    isBook,
    isLegacyEpub: row.docKind === "epub" && !docStoragePath,
    summary,
    preview,
    breadcrumb,
    tags: tagRows.map((t) => t.name),
    outgoingLinks,
    backlinks,
  });
}

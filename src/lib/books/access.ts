import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookChapters, bookNav, bookReadingState, documents } from "@/lib/db/schema";

/**
 * Ownership and shape checks every book route repeats.
 *
 * The bucket is read with the service-role key, which bypasses RLS entirely, so
 * these checks are the only thing standing between one reader and another
 * reader's library. Every route resolves the document through here first and
 * builds bucket paths from the *verified* user id, never from anything in the
 * URL.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookDoc = {
  id: string;
  userId: string;
  title: string;
  pageCount: number | null;
  metadata: Record<string, unknown> | null;
};

/** The document, if it exists, belongs to this user, and is a book. */
export async function loadBookDoc(documentId: string, userId: string): Promise<BookDoc | null> {
  if (!UUID_RE.test(documentId)) return null;

  const [row] = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      title: documents.title,
      kind: documents.kind,
      storagePath: documents.storagePath,
      pageCount: documents.pageCount,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);

  if (!row || row.kind !== "epub") return null;
  // An ePub uploaded before the reader existed has no bytes in the bucket. It
  // still reads as flat text in the Directory, but there is nothing to page
  // through, and pretending otherwise gives 404s all the way down.
  if (!row.storagePath) return null;

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    pageCount: row.pageCount,
    metadata: row.metadata,
  };
}

export async function loadChapters(documentId: string, userId: string) {
  return db
    .select({
      idx: bookChapters.idx,
      title: bookChapters.title,
      charCount: bookChapters.charCount,
      navLevel: bookChapters.navLevel,
    })
    .from(bookChapters)
    .where(and(eq(bookChapters.documentId, documentId), eq(bookChapters.userId, userId)))
    .orderBy(asc(bookChapters.idx));
}

/**
 * The book's contents, in the book's order.
 *
 * Empty for a book that shipped no nav, and for every book ingested before the
 * nav was stored — the reader falls back to listing the spine, which is a worse
 * contents list but still a usable one.
 */
export async function loadNav(documentId: string, userId: string) {
  return db
    .select({
      idx: bookNav.idx,
      title: bookNav.title,
      level: bookNav.level,
      chapterIdx: bookNav.chapterIdx,
      fragment: bookNav.fragment,
    })
    .from(bookNav)
    .where(and(eq(bookNav.documentId, documentId), eq(bookNav.userId, userId)))
    .orderBy(asc(bookNav.idx));
}

export async function loadReadingState(documentId: string, userId: string) {
  const [row] = await db
    .select()
    .from(bookReadingState)
    .where(
      and(eq(bookReadingState.documentId, documentId), eq(bookReadingState.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

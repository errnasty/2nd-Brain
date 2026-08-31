import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { xpEvents } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { resolveTypography } from "@/lib/books/typography";
import {
  loadBookDoc,
  loadChapters,
  loadHighlights,
  loadNav,
  loadReadingState,
} from "@/lib/books/access";
import { clampAnchor, progressFor } from "@/lib/books/progress";
import { bookPaths, getBookObject } from "@/lib/books/storage";
import { BookReader, type BookReaderTheme } from "@/components/reader/book/book-reader";
import type { BookHighlight } from "@/app/read/highlights";

export const dynamic = "force-dynamic";

/**
 * The reader lives outside the (app) route group on purpose: no sidebar, no
 * bottom tab bar, nothing competing with the page. Middleware still guards it.
 *
 * Everything the first page needs is loaded here rather than fetched by the
 * client, so the book opens on its saved page instead of flashing chapter one
 * while a round trip resolves.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { user } = await requireUser();
  const doc = await loadBookDoc(id, user.id);
  return { title: doc ? `${doc.title} — Reading` : "Reading" };
}

export default async function ReadBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();

  const doc = await loadBookDoc(id, user.id);
  if (!doc) notFound();

  const [chapters, nav, state, highlights, settings] = await Promise.all([
    loadChapters(id, user.id),
    loadNav(id, user.id),
    loadReadingState(id, user.id),
    loadHighlights(id, user.id),
    getUserSettings(user.id),
  ]);
  if (chapters.length === 0) notFound();

  const anchor = clampAnchor(chapters, {
    chapterIdx: state?.chapterIdx ?? 0,
    charOffset: state?.charOffset ?? 0,
  });
  // The chapter the reader will resume on, fetched here rather than left to the
  // client. Otherwise opening a book costs a full round trip after hydration
  // before a single word appears — the most visible latency in the feature, and
  // entirely avoidable since this request already has bucket access.
  //
  // The contents ticks ride alongside it rather than after it: they are
  // decoration, and putting a second round trip in front of the first word of
  // the book would spend the very latency the line above exists to save.
  const [first, readChapters] = await Promise.all([
    getBookObject(bookPaths(user.id, doc.id).chapter(anchor.chapterIdx)),
    finishedChapters(id, user.id, state?.finishedAt != null, chapters.map((c) => c.idx)),
  ]);

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const storedTheme = state?.theme;

  return (
    <BookReader
      initialHtml={first ? first.body.toString("utf8") : null}
      typography={resolveTypography(settings.bookReader)}
      readChapters={readChapters}
      initialHighlights={highlights.map((h) => ({
        ...h,
        color: (h.color as BookHighlight["color"]) ?? "yellow",
      }))}
      book={{
        id: doc.id,
        title: doc.title,
        author: typeof meta.author === "string" ? meta.author : null,
        fixedLayout: meta.fixedLayout === true,
        chapters,
        nav,
        finishedAt: state?.finishedAt?.toISOString() ?? null,
        state: {
          ...anchor,
          progressPct: state?.progressPct ?? progressFor(chapters, anchor),
          spoilerSafe: state?.spoilerSafe ?? false,
          fontScale: state?.fontScale ?? 1,
          theme:
            storedTheme === "paper" || storedTheme === "night" || storedTheme === "app"
              ? (storedTheme as BookReaderTheme)
              : null,
        },
      }}
    />
  );
}

/**
 * The chapters this reader has actually finished, for the contents list's ticks.
 *
 * Read from the XP ledger rather than from `furthest_chapter_idx`, which is a
 * high-water mark and not a claim about anything below it: jumping to chapter
 * 30 from the contents list moves it to 30 and would tick twenty-nine chapters
 * nobody read. A ledger row means the reader reached the end of that specific
 * chapter, which is exactly what a tick should mean.
 *
 * A book marked read is the one exception, and it short-circuits the query: a
 * finished book showing an unticked contents list looks broken, and it is also
 * how every book finished before chapters were tracked reports itself.
 */
async function finishedChapters(
  documentId: string,
  userId: string,
  bookFinished: boolean,
  // The book's real spine indices, not a count: they are what the contents
  // list matches against, and assuming they run 0..n-1 would tick the wrong
  // lines in any book whose spine does not.
  allChapterIdx: number[],
): Promise<number[]> {
  if (bookFinished) return allChapterIdx;
  try {
    const rows = await db
      .select({ refId: xpEvents.refId })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.userId, userId),
          eq(xpEvents.source, "chapter_read"),
          like(xpEvents.refId, `${documentId}:%`),
        ),
      );
    return rows
      .map((r) => Number((r.refId ?? "").split(":")[1]))
      .filter((n) => Number.isInteger(n));
  } catch {
    // A tick is decoration. Never let it stop a book from opening.
    return [];
  }
}

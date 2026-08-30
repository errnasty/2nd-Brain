import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadBookDoc, loadChapters, loadReadingState } from "@/lib/books/access";
import { clampAnchor, progressFor } from "@/lib/books/progress";
import { bookPaths, getBookObject } from "@/lib/books/storage";
import { BookReader, type BookReaderTheme } from "@/components/reader/book/book-reader";

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

  const [chapters, state] = await Promise.all([
    loadChapters(id, user.id),
    loadReadingState(id, user.id),
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
  const first = await getBookObject(bookPaths(user.id, doc.id).chapter(anchor.chapterIdx));

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const storedTheme = state?.theme;

  return (
    <BookReader
      initialHtml={first ? first.body.toString("utf8") : null}
      book={{
        id: doc.id,
        title: doc.title,
        author: typeof meta.author === "string" ? meta.author : null,
        fixedLayout: meta.fixedLayout === true,
        chapters,
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

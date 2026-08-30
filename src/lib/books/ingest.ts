import { chunkText } from "@/lib/documents/chunker";
import { chapterText, firstHeading, prepareChapterHtml } from "./chapter-html";
import { openEpub, spineIndexByPath, type EpubMeta } from "./epub";
import { bookPaths, putBookObject } from "./storage";

/**
 * Unzip a book once, and write out everything a reader will ever need.
 *
 * This is the whole reason reading is cheap: the read path never opens the
 * archive. Chapters land in the bucket as flat, already-sanitized HTML
 * addressed by spine index, so turning a page is one small object fetch.
 *
 * Memory is the constraint that shapes the code. JSZip holds the archive, and
 * a 50MB book decompresses to considerably more, so the spine is walked one
 * entry at a time — read it, rewrite it, upload it, drop it. Nothing ever holds
 * every chapter's HTML at once. Only the plain text accumulates, because
 * `documents.full_text` and the embedding chunks both need it.
 */

export type IngestedChapter = {
  idx: number;
  href: string;
  title: string;
  charCount: number;
  navLevel: number;
};

export type IngestedChunk = {
  index: number;
  text: string;
  approxTokens: number;
  chapterIndex: number;
};

export type IngestResult = {
  meta: EpubMeta;
  chapters: IngestedChapter[];
  chunks: IngestedChunk[];
  text: string;
  fixedLayout: boolean;
  hasCover: boolean;
  coverContentType: string | null;
  /** Assets the book referenced but the manifest did not carry. */
  missingAssets: number;
};

/** Bounded parallelism — a book with 600 images should not upload serially. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function ingestEpub(input: {
  buffer: Buffer;
  userId: string;
  documentId: string;
}): Promise<IngestResult> {
  const { buffer, userId, documentId } = input;
  const paths = bookPaths(userId, documentId);
  const book = await openEpub(buffer);

  // Keep the original. Re-rendering a book later (a better sanitizer, a new
  // reader feature) should not require the reader to find the file again.
  await putBookObject(paths.epub, buffer, "application/epub+zip");

  const spineIdxByPath = spineIndexByPath(book.spine);
  const assetUrl = (zipPath: string) =>
    `/api/book/${documentId}/asset/${zipPath.split("/").map(encodeURIComponent).join("/")}`;

  const chapters: IngestedChapter[] = [];
  const chunks: IngestedChunk[] = [];
  const textParts: string[] = [];
  let chunkIndex = 0;

  for (const entry of book.spine) {
    const raw = await book.readText(entry.zipPath);
    if (raw === null) continue;

    const html = prepareChapterHtml(raw, {
      chapterPath: entry.zipPath,
      spineIdxByPath,
      assetUrl,
    });
    await putBookObject(paths.chapter(entry.idx), Buffer.from(html, "utf8"), "text/html; charset=utf-8");

    const text = chapterText(raw);
    // A title from the book's own table of contents beats one scraped from the
    // markup; both beat "Chapter 12", which tells the reader nothing.
    const title = entry.title ?? firstHeading(raw) ?? `Chapter ${entry.idx + 1}`;

    chapters.push({
      idx: entry.idx,
      href: entry.zipPath,
      title,
      charCount: text.length,
      navLevel: entry.navLevel,
    });

    if (text) {
      textParts.push(text);
      // Chunked per chapter rather than over the whole book, so every chunk
      // knows exactly which chapter it came from and the spoiler clamp has
      // something honest to filter on.
      for (const c of chunkText(text)) {
        chunks.push({
          index: chunkIndex++,
          text: c.text,
          approxTokens: c.approxTokens,
          chapterIndex: entry.idx,
        });
      }
    }
  }

  if (chapters.length === 0) {
    throw new Error("This book has no readable chapters.");
  }

  // ── assets ────────────────────────────────────────────────────────────
  let missingAssets = 0;
  await mapPool(book.assets, 6, async (asset) => {
    const bytes = await book.readBinary(asset.zipPath);
    if (!bytes) {
      missingAssets++;
      return;
    }
    await putBookObject(paths.asset(asset.zipPath), bytes, asset.mediaType);
  });

  // ── cover ─────────────────────────────────────────────────────────────
  let hasCover = false;
  let coverContentType: string | null = null;
  if (book.coverPath) {
    const bytes = await book.readBinary(book.coverPath);
    if (bytes) {
      coverContentType = book.coverMediaType ?? "image/jpeg";
      await putBookObject(paths.cover, bytes, coverContentType);
      hasCover = true;
    }
  }

  return {
    meta: book.meta,
    chapters,
    chunks,
    text: textParts.join("\n\n"),
    fixedLayout: book.fixedLayout,
    hasCover,
    coverContentType,
    missingAssets,
  };
}

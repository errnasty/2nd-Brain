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

/**
 * Uploads in flight, capped.
 *
 * The spine has to be *walked* in order — chunk indices and the assembled text
 * depend on it — but nothing about a chapter's upload needs to finish before
 * the next chapter is read. Awaiting each one turned a 400-chapter book into
 * 400 sequential round trips to storage, which is minutes of wall clock for
 * work that is almost entirely waiting.
 *
 * The cap is what keeps the memory promise: at most `limit` chapters' HTML is
 * alive at once, rather than the whole book.
 */
class UploadQueue {
  private readonly inflight = new Map<number, Promise<void>>();
  private seq = 0;
  private failure: unknown = null;

  constructor(private readonly limit: number) {}

  async push(task: () => Promise<void>): Promise<void> {
    if (this.failure) throw this.failure;
    while (this.inflight.size >= this.limit) {
      await Promise.race(this.inflight.values());
      if (this.failure) throw this.failure;
    }
    const id = this.seq++;
    // The tracked promise never rejects, so racing on it cannot produce an
    // unhandled rejection for the siblings still in flight. The first failure
    // is kept and rethrown from the next push or from drain().
    const tracked = task()
      .catch((err: unknown) => {
        this.failure ??= err;
      })
      .finally(() => {
        this.inflight.delete(id);
      });
    this.inflight.set(id, tracked);
  }

  async drain(): Promise<void> {
    await Promise.all(this.inflight.values());
    if (this.failure) throw this.failure;
  }
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
  //
  // Started, not awaited: this is the single largest object in the whole
  // ingest and nothing downstream depends on it, so it uploads alongside the
  // spine walk instead of in front of it. The error is captured immediately so
  // a rejection cannot go unhandled while the walk runs, and rethrown once the
  // walk is done — a book whose original failed to store must still fail.
  let originalError: unknown = null;
  const originalUpload = putBookObject(paths.epub, buffer, "application/epub+zip").catch(
    (err: unknown) => {
      originalError = err;
    },
  );

  const spineIdxByPath = spineIndexByPath(book.spine);
  const assetUrl = (zipPath: string) =>
    `/api/book/${documentId}/asset/${zipPath.split("/").map(encodeURIComponent).join("/")}`;

  const chapters: IngestedChapter[] = [];
  const chunks: IngestedChunk[] = [];
  const textParts: string[] = [];
  let chunkIndex = 0;
  const uploads = new UploadQueue(8);

  for (const entry of book.spine) {
    const raw = await book.readText(entry.zipPath);
    if (raw === null) continue;

    const html = prepareChapterHtml(raw, {
      chapterPath: entry.zipPath,
      spineIdxByPath,
      assetUrl,
    });
    // Queued rather than awaited: the walk continues while this uploads.
    const body = Buffer.from(html, "utf8");
    await uploads.push(() =>
      putBookObject(paths.chapter(entry.idx), body, "text/html; charset=utf-8"),
    );

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

  await Promise.all([uploads.drain(), originalUpload]);
  if (originalError) throw originalError;

  if (chapters.length === 0) {
    throw new Error("This book has no readable chapters.");
  }

  // ── assets ────────────────────────────────────────────────────────────
  let missingAssets = 0;
  await mapPool(book.assets, 8, async (asset) => {
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

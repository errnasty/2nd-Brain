"use client";

import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What the Directory shows for a book: the book, not its text.
 *
 * A book's `full_text` is the whole thing, and rendering it here made the
 * detail view an undifferentiated wall that told you nothing you could not see
 * better in the reader. This shows the cover, who wrote it, how far in you are,
 * and one way in.
 */

export type BookInfoData = {
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
};

function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** ISO-ish language tags are not something to show a reader as-is. */
function formatLanguage(tag: string | null): string | null {
  if (!tag) return null;
  const base = tag.trim().split(/[-_]/)[0];
  if (!base) return null;
  try {
    const name = new Intl.DisplayNames(undefined, { type: "language" }).of(base);
    return name && name.toLowerCase() !== base.toLowerCase() ? name : base.toUpperCase();
  } catch {
    return base.toUpperCase();
  }
}

export function BookInfo({
  documentId,
  title,
  book,
}: {
  documentId: string;
  title: string;
  book: BookInfoData;
}) {
  const router = useRouter();
  const percent = Math.round(book.progressPct * 100);

  const facts: { label: string; value: string }[] = [];
  if (book.chapterCount > 0) {
    facts.push({ label: "Chapters", value: String(book.chapterCount) });
  }
  const language = formatLanguage(book.language);
  if (language) facts.push({ label: "Language", value: language });
  if (book.publisher) facts.push({ label: "Publisher", value: book.publisher });
  const size = formatSize(book.sizeBytes);
  if (size) facts.push({ label: "File", value: size });

  return (
    <div className="not-prose mb-8 flex flex-col gap-5 sm:flex-row sm:gap-7">
      {book.hasCover && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/book/${documentId}/cover`}
          alt={`Cover of ${title}`}
          width={256}
          height={384}
          decoding="async"
          className="aspect-[2/3] w-32 shrink-0 self-start rounded-md border border-border bg-muted object-cover shadow-md sm:w-40"
        />
      )}

      <div className="min-w-0 flex-1">
        {book.author && (
          <p className="text-[0.95rem] text-muted-foreground">by {book.author}</p>
        )}

        <Button
          size="lg"
          onClick={() => router.push(`/read/${documentId}`)}
          className="mt-4 w-full gap-2 sm:w-auto"
        >
          <BookOpen className="h-4 w-4" />
          {book.started ? "Continue reading" : "Start reading"}
        </Button>

        {book.started && (
          <div className="mt-4">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/50"
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {percent}% · Chapter {book.chapterIdx + 1}
              {book.chapterCount > 0 && ` of ${book.chapterCount}`}
              {book.chapterTitle && (
                <span className="italic"> — {book.chapterTitle}</span>
              )}
            </p>
          </div>
        )}

        {facts.length > 0 && (
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </dt>
                <dd className="min-w-0 break-words text-foreground/90">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {book.fixedLayout && (
          <p className="mt-4 rounded-md border border-border p-2.5 text-xs leading-snug text-muted-foreground">
            A fixed-layout book — its pages are designed images, so the reader scrolls them
            rather than reflowing the text.
          </p>
        )}
      </div>
    </div>
  );
}

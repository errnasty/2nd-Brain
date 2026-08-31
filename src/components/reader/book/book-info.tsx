"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Highlighter, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setBookFinishedAction } from "@/app/read/actions";
import { exportHighlightsAction } from "@/app/read/highlights";
import { celebrate } from "@/lib/gamify/celebrate";

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
  /** ISO timestamp of when it was marked read, or null. */
  finishedAt: string | null;
  highlightCount: number;
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

/**
 * Where the reader is standing right now, to hand to the book so closing it
 * comes back here.
 *
 * The whole path and query, not just the folder id: on a phone the Directory
 * IS this screen (`/directory?folder=…&item=…`), so returning to the folder
 * without the item would drop the reader on a list, one tap from where they
 * were, with the book they just closed no longer on screen. Read at click time
 * rather than at render, because the item can be opened and closed under this
 * component without it re-rendering.
 */
function here(): string {
  if (typeof window === "undefined") return "/directory";
  return `${window.location.pathname}${window.location.search}`;
}

export function BookInfo({
  documentId,
  itemId,
  title,
  book,
}: {
  documentId: string;
  /** The Directory item, so exported highlights are filed beside the book. */
  itemId: string;
  title: string;
  book: BookInfoData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [finishedAt, setFinishedAt] = useState<string | null>(book.finishedAt);
  const percent = Math.round(book.progressPct * 100);

  function toggleFinished() {
    const next = finishedAt === null;
    setFinishedAt(next ? new Date().toISOString() : null);
    startTransition(async () => {
      const r = await setBookFinishedAction({ documentId, finished: next });
      if (!r.ok) {
        // Put the button back rather than leave it claiming something untrue.
        setFinishedAt(next ? null : new Date().toISOString());
        toast.error(r.error);
        return;
      }
      // Same award the reader celebrates — a book finished from the info panel
      // is worth exactly as much as one finished on its last page.
      if (next && r.xp && r.xp.awarded > 0) {
        toast.success(`Finished — +${r.xp.awarded} XP 📖`, {
          description: r.xp.skill ? `Into ${r.xp.skill.name}.` : undefined,
        });
        celebrate(r.xp);
      }
      router.refresh();
    });
  }

  const [exporting, setExporting] = useState(false);

  function exportHighlights() {
    setExporting(true);
    startTransition(async () => {
      try {
        const r = await exportHighlightsAction({ documentId, itemId });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(`Saved ${r.count} highlight${r.count === 1 ? "" : "s"} to a note.`);
        router.push(`/directory?item=${r.noteId}`);
      } finally {
        setExporting(false);
      }
    });
  }

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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            onClick={() => router.push(`/read/${documentId}?from=${encodeURIComponent(here())}`)}
            className="w-full gap-2 sm:w-auto"
          >
            <BookOpen className="h-4 w-4" />
            {book.started ? "Continue reading" : "Start reading"}
          </Button>
          <button
            onClick={toggleFinished}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
              finishedAt
                ? "border-brand text-brand"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Check className="h-4 w-4" />
            {finishedAt ? "Read" : "Mark as read"}
          </button>
        </div>

        {finishedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Finished {new Date(finishedAt).toLocaleDateString()}
          </p>
        )}

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

        {book.highlightCount > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
            <Highlighter className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground">
              {book.highlightCount} highlight{book.highlightCount === 1 ? "" : "s"}
            </span>
            <button
              onClick={exportHighlights}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save to a note
            </button>
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

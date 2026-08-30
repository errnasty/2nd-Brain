"use client";

import { useMemo, useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryListItem } from "./directory-shell";

/**
 * The library, as a shelf.
 *
 * A list row tells you a book exists. A cover tells you which book it is —
 * recognition by spine is how anyone has ever found a book on a shelf, and it
 * works far faster than reading twenty titles. Progress rides along the bottom
 * of each cover so "the one I'm halfway through" is answerable at a glance.
 */

function Cover({ documentId, title }: { documentId: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // No cover in the file. A plain card beats a broken-image icon, and the
    // title still has to be readable at shelf size.
    return (
      <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md border border-border bg-muted p-3">
        <span className="line-clamp-5 text-center text-[0.8rem] font-medium leading-snug text-muted-foreground">
          {title}
        </span>
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/api/book/${documentId}/cover`}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      width={256}
      height={384}
      onError={() => setFailed(true)}
      className="aspect-[2/3] w-full rounded-md border border-border bg-muted object-cover"
    />
  );
}

export function DirectoryShelf({
  items,
  selectedId,
  onOpen,
}: {
  items: DirectoryListItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const books = useMemo(
    () => items.filter((i) => i.isBook && i.documentId),
    [items],
  );

  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <BookOpen className="h-8 w-8 text-muted-foreground/50" />
        <p className="editorial-display text-lg font-semibold">No books here</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Upload an ePub and it will appear on the shelf. Other kinds of item live in the list and
          board views.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
        {books.map((book) => {
          const percent = Math.round((book.bookProgress ?? 0) * 100);
          return (
            <button
              key={book.id}
              onClick={() => onOpen(book.id)}
              className={cn(
                "group min-w-0 text-left transition-opacity",
                selectedId && selectedId !== book.id && "opacity-70 hover:opacity-100",
              )}
            >
              <div className="relative">
                <div
                  className={cn(
                    "overflow-hidden rounded-md shadow-md transition-shadow group-hover:shadow-lg",
                    selectedId === book.id && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                >
                  <Cover documentId={book.documentId!} title={book.title} />
                </div>

                {book.bookFinished ? (
                  <span
                    title="Read"
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-brand text-background shadow"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : percent > 0 ? (
                  /* Sits on the cover itself, where the eye already is. */
                  <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/35 backdrop-blur-sm">
                    <div className="h-full rounded-full bg-white/90" style={{ width: `${percent}%` }} />
                  </div>
                ) : null}
              </div>

              <div className="mt-2 line-clamp-2 text-[0.8rem] font-medium leading-snug">
                {book.title}
              </div>
              {book.bookAuthor && (
                <div className="mt-0.5 truncate text-[0.72rem] text-muted-foreground">
                  {book.bookAuthor}
                </div>
              )}
              {!book.bookFinished && percent > 0 && (
                <div className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
                  {percent}%
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

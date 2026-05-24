"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { Document } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ReaderControls, useReaderPrefs } from "@/components/reader/reader-controls";
import { formatRelativeTime } from "@/lib/utils";

export function DocumentReader({ document }: { document: Document | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const prefs = useReaderPrefs();

  function close() {
    const sp = new URLSearchParams(params.toString());
    sp.delete("doc");
    router.push(`/documents?${sp.toString()}`);
  }

  if (!document) {
    return (
      <section className="hidden flex-1 items-center justify-center text-sm text-muted-foreground lg:flex">
        Select a document to read.
      </section>
    );
  }

  const readingMinutes = document.fullText
    ? Math.max(1, Math.ceil(document.fullText.split(/\s+/).length / 250))
    : null;

  return (
    <section className="flex flex-1 flex-col overflow-hidden" data-reader-theme={prefs.theme}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button size="icon" variant="ghost" onClick={close} className="lg:hidden">
          <X className="h-4 w-4" />
        </Button>
        <div className="flex-1 text-xs text-muted-foreground">
          <span className="uppercase">{document.kind}</span>
          {document.pageCount ? <span> · {document.pageCount} pages</span> : null}
          {readingMinutes ? <span> · ~{readingMinutes} min read</span> : null}
        </div>
        <ReaderControls />
      </div>
      <ScrollArea className="flex-1">
        <article
          className="prose-reader px-4 py-8"
          style={
            {
              "--reader-font": prefs.font,
              "--reader-font-size": `${prefs.fontSize}px`,
            } as React.CSSProperties
          }
        >
          <h1>{document.title}</h1>
          <div className="not-prose mb-6 text-xs text-muted-foreground">
            Added {formatRelativeTime(document.createdAt)}
          </div>
          {document.fullText ? (
            <div className="whitespace-pre-wrap">{document.fullText}</div>
          ) : (
            <p className="text-muted-foreground">No extracted text.</p>
          )}
        </article>
      </ScrollArea>
    </section>
  );
}

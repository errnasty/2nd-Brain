"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { BookOpen, FileText, FileType2, Trash2 } from "lucide-react";
import type { Document, Folder } from "@/lib/db/schema";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { UploadZone } from "./upload-zone";
import { DocumentReader } from "./document-reader";
import { deleteDocumentAction } from "@/app/(app)/documents/actions";
import { toast } from "sonner";

type DocSummary = {
  id: string;
  title: string;
  kind: Document["kind"];
  pageCount: number | null;
  sizeBytes: number | null;
  createdAt: Date;
};

export function DocumentsPanel({
  documents,
  folders: _folders,
  selected,
}: {
  documents: DocSummary[];
  folders: Folder[];
  selected: Document | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(id: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("doc", id);
    router.push(`/documents?${sp.toString()}`);
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <section className="flex w-full max-w-sm shrink-0 flex-col border-r border-border">
        <div className="p-3">
          <UploadZone />
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          {documents.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No documents yet. Drop a PDF, Markdown, text, or ePub file above.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <div
                    className={cn(
                      "group flex items-start gap-2 p-3 transition-colors",
                      selected?.id === doc.id ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <button onClick={() => select(doc.id)} className="flex-1 text-left">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <KindIcon kind={doc.kind} />
                        <span className="uppercase">{doc.kind}</span>
                        {doc.pageCount ? <span>· {doc.pageCount} pp</span> : null}
                        {doc.sizeBytes ? <span>· {formatBytes(doc.sizeBytes)}</span> : null}
                      </div>
                      <div className="text-sm font-medium leading-snug">{doc.title}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Added {formatRelativeTime(doc.createdAt)}
                      </div>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete "${doc.title}"?`)) return;
                        startTransition(async () => {
                          await deleteDocumentAction(doc.id);
                          toast.success("Deleted");
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </section>

      <DocumentReader document={selected} />
    </div>
  );
}

function KindIcon({ kind }: { kind: Document["kind"] }) {
  switch (kind) {
    case "pdf":
      return <FileType2 className="h-3.5 w-3.5" />;
    case "epub":
      return <BookOpen className="h-3.5 w-3.5" />;
    case "markdown":
    case "text":
      return <FileText className="h-3.5 w-3.5" />;
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

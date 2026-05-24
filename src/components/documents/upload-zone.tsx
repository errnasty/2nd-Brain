"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadDocumentAction } from "@/app/(app)/documents/actions";
import { toast } from "sonner";

const ACCEPT = ".pdf,.md,.markdown,.txt,.epub,application/pdf,application/epub+zip,text/markdown,text/plain";

export function UploadZone({ folderId }: { folderId?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    startTransition(async () => {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        if (folderId) fd.append("folderId", folderId);
        const result = await uploadDocumentAction(fd);
        if (result.ok) {
          toast.success(`${file.name} — ${result.chunkCount} chunks indexed`);
        } else {
          toast.error(`${file.name}: ${result.error}`);
        }
      }
    });
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card/50 px-6 py-10 text-center transition-colors",
        dragging && "border-primary bg-accent",
        pending && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        multiple
        onChange={(e) => e.target.files && upload(e.target.files)}
      />
      {pending ? (
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      ) : (
        <Upload className="h-7 w-7 text-muted-foreground" />
      )}
      <div className="text-sm font-medium">
        {pending ? "Processing…" : "Drag files here or click to upload"}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>PDF · Markdown · Text · ePub</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Max 20MB locally · ~4.5MB on Vercel free/pro
      </div>
    </div>
  );
}

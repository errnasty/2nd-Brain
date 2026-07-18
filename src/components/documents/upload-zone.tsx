"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Upload, FileText } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { uploadDocumentAction } from "@/app/(app)/documents/actions";
import { maxUploadBytes, maxUploadLabel } from "@/lib/upload-limits";
import { toast } from "sonner";

const ACCEPT = ".pdf,.md,.markdown,.txt,.epub,application/pdf,application/epub+zip,text/markdown,text/plain";

export function UploadZone({ folderId }: { folderId?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  // Computed after mount so the SSR (web) and client (desktop) labels don't
  // mismatch — the limit depends on window.desktop.
  const [limitLabel, setLimitLabel] = useState("");
  useEffect(() => setLimitLabel(maxUploadLabel()), []);

  async function upload(files: FileList | File[]) {
    const all = Array.from(files);
    if (all.length === 0) return;

    // Reject oversized files up front. On the hosted web app the platform's
    // serverless body cap is well below 20MB, so this is the REAL limit — without
    // it the upload dies with an opaque 413 the action never sees.
    const max = maxUploadBytes();
    const list = all.filter((f) => {
      if (f.size > max) {
        toast.error(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)}MB — over the ${maxUploadLabel()} limit.`);
        return false;
      }
      return true;
    });
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
        onChange={(e) => {
          if (e.target.files) upload(e.target.files);
          // Reset so re-picking the SAME file (e.g. after a failed upload) still
          // fires a change event.
          e.target.value = "";
        }}
      />
      {pending ? (
        <Spinner className="h-7 w-7 text-muted-foreground" />
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
      <div className="text-[11px] text-muted-foreground">{limitLabel && `Max ${limitLabel} per file`}</div>
    </div>
  );
}

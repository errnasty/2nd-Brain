"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importOpmlAction, type OpmlImportResult } from "@/app/(app)/feeds/actions";
import { toast } from "sonner";

export function ImportOpmlDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OpmlImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const r = await importOpmlAction(fd);
      setResult(r);
      if (r.ok) toast.success(`Imported ${r.feedsAdded} feeds (${r.feedsSkipped} duplicates)`);
      else toast.error(r.error ?? "Import failed");
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setFile(null);
          setResult(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from Inoreader (or any OPML)</DialogTitle>
          <DialogDescription>
            In Inoreader: <span className="font-medium">Preferences → Import / Export → Export OPML</span>.
            Drop the downloaded <code>.opml</code> file here. Folders and feeds will be re-created;
            duplicates are skipped.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card/50 px-6 py-10 text-center transition-colors hover:bg-accent"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".opml,.xml,application/xml,text/xml"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="h-7 w-7 text-muted-foreground" />
            <div className="text-sm font-medium">
              {file ? file.name : "Click to pick an OPML file"}
            </div>
            <div className="text-xs text-muted-foreground">
              Inoreader, Feedly, NetNewsWire, Reeder — all export this format
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-1 rounded-md border border-border p-3 text-sm">
            <div>Folders created: <span className="font-medium">{result.foldersCreated}</span></div>
            <div>Feeds added: <span className="font-medium">{result.feedsAdded}</span></div>
            <div>Duplicates skipped: <span className="font-medium">{result.feedsSkipped}</span></div>
            {result.feedsFailed > 0 && (
              <div className="text-destructive">
                Failed first sync: <span className="font-medium">{result.feedsFailed}</span>
                <div className="text-xs text-muted-foreground">
                  You can retry each one from the feed row in the sidebar.
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button disabled={!file || pending} onClick={submit}>
              {pending ? "Importing…" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

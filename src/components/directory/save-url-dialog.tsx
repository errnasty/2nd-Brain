"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Input } from "@/components/ui/input";
import { saveUrlToDirectoryAction } from "@/app/(app)/directory/actions";
import { toast } from "sonner";

/**
 * Paste any web page URL and capture it into the Directory — outside of an
 * RSS subscription. Extracts readable text (same Readability pipeline feed
 * articles use) so the saved page gets flashcards/quiz/tagging/Ask like any
 * other item.
 */
export function SaveUrlDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Active Directory folder (or "unsorted"/null) — the saved page lands here. */
  folder: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  function save() {
    const u = url.trim();
    if (!u || loading) return;
    setLoading(true);
    const folderId = folder && folder !== "unsorted" ? folder : null;
    saveUrlToDirectoryAction(u, folderId)
      .then((r) => {
        if (r.ok) {
          toast.success(r.alreadySaved ? "Already in your Directory" : "Page saved");
          onOpenChange(false);
          setUrl("");
          router.push(`/directory?item=${r.itemId}`);
          router.refresh();
        } else {
          toast.error(r.error);
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save this page"))
      .finally(() => setLoading(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Link2 className="h-4 w-4" /> Save a page
          </DialogPrimitive.Title>
          <p className="mb-4 text-xs text-muted-foreground">
            Paste a link — the readable text gets pulled in as a Directory item.
          </p>
          <Input
            autoFocus
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="https://…"
            disabled={loading}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <LoadingButton onClick={save} loading={loading} disabled={!url.trim()} className="gap-1.5">
              {!loading && <Link2 className="h-3.5 w-3.5" />}
              Save
            </LoadingButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

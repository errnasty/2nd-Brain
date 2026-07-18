"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { NotebookPen } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { autoTagItemAction, createNoteAction, saveUrlToDirectoryAction } from "@/app/(app)/directory/actions";
import { toast } from "sonner";

/**
 * Frictionless global capture — "grab the idea before it vanishes". Opens from
 * anywhere via the `c` shortcut, the command palette, or the mobile + button
 * (all dispatch the `open-quick-capture` event). Saves a note straight into
 * Unsorted/Inbox with createNoteAction, so Organize stays a separate step.
 */
export function QuickCapture() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("open-quick-capture", onOpen);
    return () => window.removeEventListener("open-quick-capture", onOpen);
  }, []);

  // Reset fields each time it opens.
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setSaving(false);
    }
  }, [open]);

  // A pasted single bare URL (nothing else typed) captures the whole page
  // instead of a note — "grab the idea" extends naturally to "grab the page".
  const soleText = body.trim() || title.trim();
  const urlToSave = /^https?:\/\/\S+$/.test(soleText) ? soleText : null;

  async function saveUrl(thenOpen: boolean) {
    if (!urlToSave) return;
    setSaving(true);
    const r = await saveUrlToDirectoryAction(urlToSave, null);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setOpen(false);
    if (thenOpen) {
      router.push(`/directory?item=${r.itemId}`);
    } else {
      toast.success(r.alreadySaved ? "Already in your Directory" : "Page saved", {
        action: { label: "Open", onClick: () => router.push(`/directory?item=${r.itemId}`) },
      });
    }
  }

  async function save(thenOpen: boolean) {
    // Derive a title from the first line of the body when none is given, so a
    // pure brain-dump still saves with one keystroke.
    const t = title.trim() || body.trim().split("\n")[0]?.slice(0, 80) || "Untitled note";
    if (!body.trim() && !title.trim()) return;
    setSaving(true);
    const r = await createNoteAction({ title: t, content: body, folderId: null });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setOpen(false);
    // A capture is a finished note — tag it now rather than waiting for the
    // user to open and re-close it in the Directory. Same length gate as the
    // viewer's auto-tag-on-finish so trivial one-liners aren't sent to the AI.
    if (body.trim().length >= 80) void autoTagItemAction(r.itemId);
    if (thenOpen) {
      router.push(`/directory?item=${r.itemId}`);
    } else {
      toast.success("Captured to Unsorted", {
        action: { label: "Open", onClick: () => router.push(`/directory?item=${r.itemId}`) },
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Cmd/Ctrl+Enter saves; Shift adds the "open after save" intent.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (urlToSave) void saveUrl(e.shiftKey);
      else void save(e.shiftKey);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
          onKeyDown={onKeyDown}
          className="fixed left-[50%] top-[15%] z-50 w-full max-w-xl translate-x-[-50%] overflow-hidden rounded-xl border border-border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="editorial-eyebrow-brand flex items-center gap-2 border-b border-border px-4 py-3">
            <NotebookPen className="h-3.5 w-3.5" /> § Quick capture
          </DialogPrimitive.Title>
          <div className="space-y-2 p-3">
            <Input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="border-0 px-1 text-base font-medium shadow-none focus-visible:ring-0"
            />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Capture a thought, quote, or link… paste a bare URL to save the whole page."
              className="min-h-[40vh] resize-none border-0 px-1 text-sm leading-relaxed shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {urlToSave ? (
                "Link detected — saves the full page"
              ) : (
                <>
                  <kbd className="rounded border border-border bg-muted px-1">⌘/Ctrl ⏎</kbd> save ·{" "}
                  <kbd className="rounded border border-border bg-muted px-1">⇧⌘ ⏎</kbd> save &amp; open
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <LoadingButton
                size="sm"
                loading={saving}
                loadingText="Saving…"
                onClick={() => (urlToSave ? saveUrl(false) : save(false))}
                disabled={!body.trim() && !title.trim()}
              >
                {urlToSave ? "Save page" : "Capture"}
              </LoadingButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { GraduationCap } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { BusyOverlay } from "@/components/ui/busy-overlay";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { runBackgroundJob } from "@/lib/ui/background-job";

/**
 * Topic deep-dive: ask for a theme, generate a Prereqs→Core→Advanced curriculum
 * that links existing items and fills gaps, saved as a living note.
 */
export function CurriculumDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folder: string | null;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Closing the dialog (Cancel / Esc / outside-click) aborts the in-flight
  // generation so it can't force-navigate ~20s later after the user has left.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function generate() {
    const t = topic.trim();
    if (!t || loading) return;
    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = toast.loading(`Building a curriculum for "${t}"…`);
    // Background job: create → kick → poll, so a serverless timeout on the
    // long AI call can never surface as a false error. Closing the dialog
    // aborts the *watch* only — the note still lands in the Directory.
    void runBackgroundJob({
      kind: "curriculum",
      topic: t,
      folderId: folder && folder !== "unsorted" ? folder : null,
      signal: controller.signal,
      onDone: (itemId) => {
        setLoading(false);
        toast.success("Curriculum saved", { id });
        onOpenChange(false);
        setTopic("");
        router.push(`/directory?item=${itemId}`);
        router.refresh();
      },
      onError: (message) => {
        setLoading(false);
        toast.error(message, { id });
      },
      onStillWorking: () => {
        setLoading(false);
        toast.message("Still building — the curriculum note will appear in your Directory shortly.", { id });
        onOpenChange(false);
        setTopic("");
      },
    });
    controller.signal.addEventListener(
      "abort",
      () => {
        toast.dismiss(id);
        setLoading(false);
      },
      { once: true },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <BusyOverlay show={loading} label="Building your curriculum… ~20s" />
          <DialogPrimitive.Title className="mb-1 flex items-center gap-2 text-base font-semibold">
            <GraduationCap className="h-4 w-4" /> Generate curriculum
          </DialogPrimitive.Title>
          <p className="mb-4 text-xs text-muted-foreground">
            A structured learning path that links your existing notes and flags gaps.
          </p>
          <Input
            autoFocus
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            placeholder="e.g. Information Operations, transformers, options pricing"
            disabled={loading}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <LoadingButton onClick={generate} loading={loading} disabled={!topic.trim()} className="gap-1.5">
              {!loading && <GraduationCap className="h-3.5 w-3.5" />}
              Generate
            </LoadingButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

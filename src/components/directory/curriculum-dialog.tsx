"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { GraduationCap, Loader2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

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

  function generate() {
    const t = topic.trim();
    if (!t || loading) return;
    setLoading(true);
    const id = toast.loading(`Building a curriculum for "${t}"…`);
    fetch("/api/curriculum", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: t, folderId: folder && folder !== "unsorted" ? folder : null }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.itemId) {
          toast.success("Curriculum saved", { id });
          onOpenChange(false);
          setTopic("");
          router.push(`/directory?item=${data.itemId}`);
          router.refresh();
        } else {
          toast.error(data.error ?? "Failed", { id });
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed", { id }))
      .finally(() => setLoading(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
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
            <Button onClick={generate} disabled={loading || !topic.trim()} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

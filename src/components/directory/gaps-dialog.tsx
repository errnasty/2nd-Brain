"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lightbulb, Search } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { isSeveredResponse } from "@/lib/ui/severed";

type Gap = { topic: string; why: string };

/**
 * Knowledge-gap detector dialog. On open it asks /api/gaps for the current
 * folder/tag scope, then each gap offers a one-click web "Research" that saves
 * a briefing note into the Directory.
 */
export function GapsDialog({
  open,
  onOpenChange,
  folder,
  tagIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folder: string | null;
  tagIds: string[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [gapsError, setGapsError] = useState(false);
  const [scope, setScope] = useState("");
  const [researching, setResearching] = useState<string | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);

  function loadGaps() {
    setLoading(true);
    setGaps(null);
    setGapsError(false);
    fetch("/api/gaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, tagIds }),
    })
      .then(async (res) => {
        // Distinguish a failed analysis from a genuinely empty result.
        if (!res.ok) {
          setGapsError(true);
          return;
        }
        const data = await res.json();
        setGaps(data.gaps ?? []);
        setScope(data.scope ?? "");
      })
      .catch(() => setGapsError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    loadGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folder, tagIds]);

  // Abort an in-flight research request when the dialog closes/unmounts so it
  // can't force-navigate after the user has left.
  useEffect(() => {
    if (!open) researchAbortRef.current?.abort();
  }, [open]);
  useEffect(() => () => researchAbortRef.current?.abort(), []);

  function research(topic: string) {
    if (researching) return;
    setResearching(topic);
    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;
    const id = toast.loading(`Researching "${topic}"…`);
    fetch("/api/gaps/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, folderId: folder && folder !== "unsorted" ? folder : null }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (controller.signal.aborted) return; // dialog was closed — don't navigate
        if (res.ok && data.itemId) {
          toast.success("Saved research note", { id });
          onOpenChange(false);
          router.push(`/directory?item=${data.itemId}`);
          router.refresh();
        } else {
          toast.error(data.error ?? "Research failed", { id });
        }
      })
      .catch((e) => {
        if ((e as Error)?.name === "AbortError") {
          toast.dismiss(id);
          return;
        }
        // A severed long response isn't a failure — the note still lands.
        if (isSeveredResponse(e)) {
          toast.message("Still researching in the background — the note will appear in your Directory shortly.", { id });
          onOpenChange(false);
          return;
        }
        toast.error(e instanceof Error ? e.message : "Research failed", { id });
      })
      .finally(() => setResearching(null));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Lightbulb className="h-4 w-4" /> Knowledge gaps
          </DialogPrimitive.Title>
          <p className="mb-4 text-xs text-muted-foreground">
            Missing subtopics &amp; counter-perspectives in {scope || "this view"}.
          </p>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner /> Analyzing your collection…
              </div>
            ) : gapsError ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                Couldn&apos;t analyze your collection.
                <Button size="sm" variant="outline" onClick={loadGaps}>
                  Try again
                </Button>
              </div>
            ) : gaps && gaps.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No obvious gaps — or not enough items in this view to analyze.
              </div>
            ) : (
              gaps?.map((g) => (
                <div
                  key={g.topic}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{g.topic}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{g.why}</div>
                  </div>
                  <LoadingButton
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    loading={researching === g.topic}
                    disabled={researching !== null}
                    onClick={() => research(g.topic)}
                  >
                    {researching !== g.topic && <Search className="h-3.5 w-3.5" />}
                    Research
                  </LoadingButton>
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

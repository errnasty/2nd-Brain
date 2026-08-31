"use client";

import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FolderPlus, FolderMinus, Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sortReportAction, type SortReport } from "@/app/(app)/directory/actions";
import { undoSort } from "@/lib/ui/organize-job";

/**
 * Where everything went, after a sort.
 *
 * ## Why counts were not enough
 *
 * "40 items filed · 3 new folders" says a sort happened. It does not say
 * whether it put the tax documents in "Machine Learning" — which is the only
 * question anyone has once their library has rearranged itself, and the reason
 * people hesitate to press the button at all. Seeing the moves is what makes
 * the feature safe to use, and the undo is right here for when the answer is
 * "no".
 *
 * ## Why it is grouped by destination
 *
 * A flat list of moves is read one row at a time and answers nothing. Grouped
 * by the folder things landed in, the shape of the decision is visible at a
 * glance: a folder with thirty unrelated titles under it is obviously wrong,
 * and so is a folder with one.
 */
export function SortReportDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [report, setReport] = useState<SortReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!open || !jobId) return;
    setLoading(true);
    setReport(null);
    sortReportAction(jobId)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [open, jobId]);

  // Group the moves by where they landed, biggest folder first — the folder
  // that swallowed the most is the one worth checking.
  const groups = useMemo(() => {
    const by = new Map<string, { title: string; from: string | null }[]>();
    for (const m of report?.report.moves ?? []) {
      const list = by.get(m.to) ?? [];
      list.push({ title: m.title, from: m.from });
      by.set(m.to, list);
    }
    return [...by.entries()]
      .map(([folder, items]) => ({ folder, items }))
      .sort((a, b) => b.items.length - a.items.length || a.folder.localeCompare(b.folder));
  }, [report]);

  const created = new Set(report?.foldersCreated ?? []);

  async function runUndo() {
    if (!report) return;
    setUndoing(true);
    try {
      await undoSort(report.jobId);
      onOpenChange(false);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 flex max-h-[85vh] w-full max-w-xl translate-x-[-50%] translate-y-[-50%] flex-col rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="mb-1 text-base font-semibold">
            Where everything went
          </DialogPrimitive.Title>
          <p className="mb-4 text-xs text-muted-foreground">
            {report
              ? `${report.scope === "everything" ? "Reorganised everything" : "Sorted unsorted items"} · ${report.description}`
              : " "}
          </p>

          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking it up…
            </div>
          ) : !report ? (
            <p className="py-8 text-center text-sm italic text-muted-foreground">
              That sort is no longer available.
            </p>
          ) : groups.length === 0 && report.report.unplaced.length === 0 ? (
            <p className="py-8 text-center text-sm italic text-muted-foreground">
              Nothing was moved.
            </p>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {groups.map((g) => (
                <section key={g.folder}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{g.folder}</span>
                    {created.has(g.folder) && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        <FolderPlus className="h-2.5 w-2.5" /> new
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {g.items.length}
                    </span>
                  </div>
                  <ul className="space-y-0.5 border-l border-border pl-3">
                    {g.items.map((item, i) => (
                      <li key={`${item.title}-${i}`} className="text-[13px] leading-snug">
                        <span className="text-foreground">{item.title}</span>{" "}
                        {/* Where it came from is the half that matters on a
                            re-run: moving something OUT of a folder you chose
                            by hand is the change worth noticing. */}
                        <span className="text-muted-foreground">
                          — from {item.from ?? "Unsorted"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {report.report.unplaced.length > 0 && (
                <section>
                  <div className="mb-1.5 text-sm font-medium text-muted-foreground">
                    Left where they were · {report.report.unplaced.length}
                  </div>
                  <ul className="space-y-0.5 border-l border-dashed border-border pl-3">
                    {report.report.unplaced.map((title, i) => (
                      <li key={`${title}-${i}`} className="text-[13px] leading-snug text-muted-foreground">
                        {title}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {report.foldersRemoved.length > 0 && (
                <section>
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <FolderMinus className="h-3.5 w-3.5" /> Empty folders removed
                  </div>
                  <p className="border-l border-dashed border-border pl-3 text-[13px] leading-snug text-muted-foreground">
                    {report.foldersRemoved.join(", ")}
                  </p>
                </section>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-between gap-2">
            {report?.canUndo ? (
              <Button variant="outline" onClick={runUndo} disabled={undoing}>
                {undoing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Put it all back
              </Button>
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={undoing}>
              Close
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

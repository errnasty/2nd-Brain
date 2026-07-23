"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Wand2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  applyAutoOrganizeAction,
  previewAutoOrganizeAction,
  type OrganizeProposal,
} from "@/app/(app)/directory/actions";

/**
 * Auto-organize's review step: shows what the assistant proposes (assign to
 * an existing folder, or create a new one for a cluster of items) as
 * checkable rows. Nothing in the Directory changes until "Apply" is pressed —
 * matches the propose-then-approve pattern used elsewhere in the app rather
 * than applying silently in the background.
 */
export function AutoOrganizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<OrganizeProposal[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setProposals([]);
    setChecked(new Set());
    previewAutoOrganizeAction()
      .then((r) => {
        if (r.ok) {
          setProposals(r.proposals);
          setChecked(new Set(r.proposals.map((p) => p.id)));
        } else {
          toast.error(r.error);
          onOpenChange(false);
        }
      })
      .catch(() => {
        toast.error("Couldn't get organize suggestions");
        onOpenChange(false);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    const selected = proposals.filter((p) => checked.has(p.id));
    if (selected.length === 0) return;
    setApplying(true);
    try {
      const r = await applyAutoOrganizeAction(selected);
      onOpenChange(false);
      const folderMsg =
        r.foldersCreated.length > 0
          ? ` · created ${r.foldersCreated.length} folder${r.foldersCreated.length === 1 ? "" : "s"}: ${r.foldersCreated.join(", ")}`
          : "";
      toast.success(`Organized ${r.routed} item${r.routed === 1 ? "" : "s"}${folderMsg}`);
      if (r.skipped > 0) {
        toast.error(
          `Couldn't organize ${r.skipped} item${r.skipped === 1 ? "" : "s"} — the destination folder couldn't be created or found.`,
        );
      }
      router.refresh();
    } catch {
      toast.error("Couldn't apply those changes");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 flex max-h-[80vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Wand2 className="h-4 w-4" /> Auto-organize suggestions
          </DialogPrimitive.Title>
          <p className="mb-4 text-xs text-muted-foreground">
            Review what the assistant wants to do with your unsorted items — nothing changes until you apply.
          </p>

          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          ) : proposals.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-muted-foreground">
              Nothing confident to suggest right now — add a few more unsorted items and try again.
            </p>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {proposals.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 text-sm transition-colors hover:bg-accent/40"
                >
                  <Checkbox checked={checked.has(p.id)} onCheckedChange={() => toggle(p.id)} className="mt-0.5" />
                  <span className="leading-snug">
                    {p.action === "create_folder" ? (
                      <>
                        Create folder <strong>&ldquo;{p.folderName}&rdquo;</strong> with {p.itemTitles.length} item
                        {p.itemTitles.length === 1 ? "" : "s"}:{" "}
                        <span className="text-muted-foreground">{p.itemTitles.join(", ")}</span>
                      </>
                    ) : (
                      <>
                        Move <strong>&ldquo;{p.itemTitle}&rdquo;</strong> to <strong>{p.folderName}</strong>
                      </>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>
              Cancel
            </Button>
            <Button variant="brand" onClick={apply} disabled={applying || loading || checked.size === 0}>
              {applying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Apply{checked.size > 0 ? ` (${checked.size})` : ""}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

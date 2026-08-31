"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FolderTree, Loader2, Sparkles, Undo2, Wand2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  applyAutoOrganizeAction,
  lastUndoableSortAction,
  previewAutoOrganizeAction,
  type LastSort,
  type OrganizeProposal,
} from "@/app/(app)/directory/actions";
import { startOrganizeJob, undoSort } from "@/lib/ui/organize-job";

type Mode = "menu" | "review";

/**
 * The Directory's sort dialog.
 *
 * Three things live here, in the order someone reaches for them:
 *
 *   - **Sort what's unsorted** (background). Files loose items into folders,
 *     creating folders when there are none that fit — including the case of a
 *     brand-new library with no folders at all, where the old flow could only
 *     shrug.
 *   - **Reorganise everything** (background). Reconsiders every item, including
 *     ones already filed, and optionally clears out the folders left empty.
 *     This is the "make it all neater" button, and it says plainly that it
 *     moves things that are already sorted.
 *   - **Review suggestions first** (foreground). The original propose-then-
 *     approve flow, kept for anyone who would rather see the list before
 *     anything moves.
 *
 * Both background runs close this dialog immediately: the work continues in the
 * status strip at the top of the app, and a toast — carrying an undo — lands
 * when it finishes. The undo for the last completed sort is also offered here,
 * because a toast is long gone by the time someone has clicked into two folders
 * and decided they liked the old arrangement better.
 */
export function AutoOrganizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");
  const [pruneEmpty, setPruneEmpty] = useState(true);
  const [starting, setStarting] = useState<null | "unsorted" | "everything">(null);
  const [lastSort, setLastSort] = useState<LastSort | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("menu");
    setStarting(null);
    lastUndoableSortAction()
      .then(setLastSort)
      .catch(() => setLastSort(null));
  }, [open]);

  async function start(scope: "unsorted" | "everything") {
    setStarting(scope);
    const r = await startOrganizeJob({ scope, pruneEmpty: scope === "everything" && pruneEmpty });
    setStarting(null);
    if (!r.ok) {
      // "Already running" is not a failure — the sort the user wanted is
      // happening and is now on screen, so get out of the way rather than
      // leaving them staring at a dialog with a red toast over it.
      if (r.attached) {
        onOpenChange(false);
        toast(r.error);
        return;
      }
      toast.error(r.error);
      return;
    }
    onOpenChange(false);
    toast.success("Sorting in the background", {
      description: "Carry on — you'll get a summary (and an undo) when it's done.",
    });
  }

  async function runUndo() {
    if (!lastSort) return;
    setUndoing(true);
    try {
      await undoSort(lastSort.jobId);
      setLastSort(null);
      onOpenChange(false);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 flex max-h-[85vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {mode === "menu" ? (
            <SortMenu
              starting={starting}
              pruneEmpty={pruneEmpty}
              setPruneEmpty={setPruneEmpty}
              onStart={start}
              onReview={() => setMode("review")}
              lastSort={lastSort}
              undoing={undoing}
              onUndo={runUndo}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <ReviewPanel
              onBack={() => setMode("menu")}
              onDone={() => {
                onOpenChange(false);
                router.refresh();
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function SortMenu({
  starting,
  pruneEmpty,
  setPruneEmpty,
  onStart,
  onReview,
  lastSort,
  undoing,
  onUndo,
  onClose,
}: {
  starting: null | "unsorted" | "everything";
  pruneEmpty: boolean;
  setPruneEmpty: (v: boolean) => void;
  onStart: (scope: "unsorted" | "everything") => void;
  onReview: () => void;
  lastSort: LastSort | null;
  undoing: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  const busy = starting !== null || undoing;
  return (
    <>
      <DialogPrimitive.Title className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Wand2 className="h-4 w-4" /> Sort my directory
      </DialogPrimitive.Title>
      <p className="mb-4 text-xs text-muted-foreground">
        Sorting runs in the background — close this and carry on working.
      </p>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <SortOption
          icon={<Sparkles className="h-4 w-4" />}
          title="Sort what's unsorted"
          description="Files your loose items into folders, making new folders where nothing fits. Nothing that's already filed moves."
          busy={starting === "unsorted"}
          disabled={busy}
          onClick={() => onStart("unsorted")}
        />

        <div className="rounded-lg border border-border">
          <SortOption
            bare
            icon={<FolderTree className="h-4 w-4" />}
            title="Reorganise everything"
            description="Rethinks the whole structure and re-files every item — including ones already in folders."
            busy={starting === "everything"}
            disabled={busy}
            onClick={() => onStart("everything")}
          />
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-border px-3 py-2.5 text-xs">
            <Checkbox
              checked={pruneEmpty}
              onCheckedChange={(v) => setPruneEmpty(v === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <span className="leading-snug">
              Delete folders left empty
              <span className="block text-muted-foreground">
                Only folders holding nothing at all — no items, no subfolders.
              </span>
            </span>
          </label>
        </div>

        <button
          onClick={onReview}
          disabled={busy}
          className="w-full rounded-lg border border-dashed border-border p-3 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
        >
          <span className="font-medium">Review suggestions first</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            See what would happen to your unsorted items and approve it item by item.
          </span>
        </button>
      </div>

      {lastSort && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Not happy with the last sort?</div>
            <div className="truncate text-muted-foreground">{lastSort.description}</div>
          </div>
          <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onUndo} disabled={busy}>
            {undoing && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Undo it
          </Button>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
      </div>
    </>
  );
}

function SortOption({
  icon,
  title,
  description,
  busy,
  disabled,
  onClick,
  bare,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  bare?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-50",
        bare ? "rounded-t-lg" : "rounded-lg border border-border",
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * The original propose-then-approve flow: shows what the assistant wants to do
 * with the unsorted items as checkable rows, and changes nothing until Apply.
 */
function ReviewPanel({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<OrganizeProposal[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setLoading(true);
    previewAutoOrganizeAction()
      .then((r) => {
        if (r.ok) {
          setProposals(r.proposals);
          setChecked(new Set(r.proposals.map((p) => p.id)));
        } else {
          toast.error(r.error);
          onBack();
        }
      })
      .catch(() => {
        toast.error("Couldn't get organize suggestions");
        onBack();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      onDone();
    } catch {
      toast.error("Couldn't apply those changes");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
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
        <Button variant="ghost" onClick={onBack} disabled={applying}>
          Back
        </Button>
        <Button variant="brand" onClick={apply} disabled={applying || loading || checked.size === 0}>
          {applying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Apply{checked.size > 0 ? ` (${checked.size})` : ""}
        </Button>
      </div>
    </>
  );
}

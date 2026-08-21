"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Markdown } from "@/components/ui/markdown";
import { ArrowLeft, ExternalLink, Library, Rabbit, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfirm } from "@/components/ui/app-dialogs";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Rabbithole } from "@/components/reader/rabbithole";

export type HoleSummary = {
  itemId: string;
  title: string;
  branchCount: number;
  lastAt: string;
};
export type RecentItem = { id: string; title: string; kind: string };
export type RootDoc = { itemId: string; title: string; text: string; markdown: boolean };

/**
 * The Rabbithole tab: browse every hole you've dug, resume one, or start a new
 * one from a recent Directory item. Split view — the root document on the left
 * (select text to dig), the always-visible branch panel on the right.
 */
export function RabbitholeShell({
  holes,
  recent,
  root,
}: {
  holes: HoleSummary[];
  recent: RecentItem[];
  root: RootDoc | null;
}) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  // Hidden optimistically so the row goes the moment you confirm, rather than
  // lingering until the server round trip and refresh land. Restored on failure.
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());

  async function deleteHole(hole: HoleSummary) {
    const ok = await confirm({
      title: `Delete this rabbithole?`,
      body: `"${hole.title}" — ${hole.branchCount} branch${hole.branchCount === 1 ? "" : "es"} will be deleted. The document itself stays in your Directory.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    setDeleted((prev) => new Set(prev).add(hole.itemId));
    startTransition(async () => {
      try {
        const res = await fetch(`/api/rabbithole/hole/${hole.itemId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Rabbithole deleted");
        // Leaving the hole open after deleting it would show an empty branch
        // panel over a document that is no longer a hole.
        if (root?.itemId === hole.itemId) router.push("/rabbithole");
        else router.refresh();
      } catch (err) {
        setDeleted((prev) => {
          const next = new Set(prev);
          next.delete(hole.itemId);
          return next;
        });
        toast.error(`Delete failed: ${err instanceof Error ? err.message : "error"}`);
      }
    });
  }

  const visibleHoles = holes.filter((h) => !deleted.has(h.itemId));

  const holeList = (
    <>
      {visibleHoles.length > 0 && (
        <div>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your holes
          </div>
          {/* A row is two controls, so it is a div wrapping them rather than a
              button containing one — a nested button is invalid HTML and the
              inner click never reliably wins. The delete control stays visible
              on touch (no hover to reveal it) and is only faded until hover on
              pointer devices. */}
          {visibleHoles.map((h) => (
            <div
              key={h.itemId}
              className={cn(
                "group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/50",
                root?.itemId === h.itemId && "bg-accent",
              )}
            >
              <button
                onClick={() => router.push(`/rabbithole?item=${h.itemId}`)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-2 text-left"
              >
                <span className="truncate text-sm font-medium">{h.title}</span>
                <span className="text-xs text-muted-foreground">
                  {h.branchCount} branch{h.branchCount === 1 ? "" : "es"} ·{" "}
                  {formatRelativeTime(h.lastAt)}
                </span>
              </button>
              <button
                onClick={() => void deleteHole(h)}
                title={`Delete "${h.title}"`}
                aria-label={`Delete rabbithole "${h.title}"`}
                className="shrink-0 rounded p-1.5 text-muted-foreground opacity-100 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className={visibleHoles.length > 0 ? "mt-4" : ""}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Start a new hole
          </div>
          {recent.map((r) => (
            <button
              key={r.id}
              onClick={() => router.push(`/rabbithole?item=${r.id}`)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50",
                root?.itemId === r.id && "bg-accent",
              )}
            >
              <span className="truncate">{r.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                {r.kind.replace("_", " ")}
              </span>
            </button>
          ))}
        </div>
      )}
      {visibleHoles.length === 0 && recent.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">
          Nothing in your Directory yet — save an article, upload a document, or write a note
          first.
        </p>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
      {/* Hole list — desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Rabbit className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Rabbithole</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">{holeList}</div>
        </ScrollArea>
      </aside>

      {root ? (
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
          {/* Root document */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              {/* The hole list is a desktop-only sidebar; on mobile this is the
                  only way back out of a hole to pick/start another one. */}
              <button
                onClick={() => router.push("/rabbithole")}
                className="-ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
                title="All holes"
                aria-label="Back to all holes"
              >
                <ArrowLeft className="h-4 w-4" />
                Holes
              </button>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{root.title}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                — select text to dig
              </span>
              <button
                onClick={() => router.push(`/directory?item=${root.itemId}`)}
                className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="Open in Directory"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Directory
              </button>
            </div>
            <ScrollArea className="min-w-0 flex-1">
              <div ref={bodyRef} className="mx-auto w-full max-w-[68ch] px-4 py-6 sm:px-6 sm:py-8">
                {root.text.trim() ? (
                  root.markdown ? (
                    <div className="prose-reader break-words">
                      <Markdown>{root.text}</Markdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
                      {root.text}
                    </div>
                  )
                ) : (
                  <p className="italic text-muted-foreground">
                    No readable text in this item yet.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Branch panel — stacked below on mobile, right column on desktop.
              On mobile: svh (accounts for browser chrome) + a max so a short
              screen still leaves the document readable; min-w-0/overflow-hidden
              keep long answers from forcing horizontal scroll. */}
          <div className="h-[45svh] max-h-[55%] min-w-0 shrink-0 overflow-hidden border-t border-border lg:h-auto lg:max-h-none lg:w-[440px] lg:border-l lg:border-t-0">
            <Rabbithole
              variant="inline"
              itemId={root.itemId}
              rootTitle={root.title}
              bodyRef={bodyRef}
              enabled
              open
              onOpenChange={() => {}}
            />
          </div>
        </div>
      ) : (
        /* No hole selected: hero + (on smaller screens) the hole list itself */
        <ScrollArea className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-xl px-6 py-10">
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <Rabbit className="h-10 w-10 text-primary/60" />
              <h1 className="editorial-display text-2xl font-bold tracking-tight">Rabbithole</h1>
              <p className="text-sm text-muted-foreground">
                Pick something to read, select any passage, and ask — the answer opens as a child
                document you can dig into again. Every hole is saved and revisitable.
              </p>
            </div>
            <div className="lg:hidden">{holeList}</div>
            <div className="hidden text-center text-sm text-muted-foreground lg:block">
              <Library className="mr-1 inline h-4 w-4" />
              Choose a hole or a Directory item from the left to begin.
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

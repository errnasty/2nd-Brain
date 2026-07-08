"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Library, Rabbit } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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

  const holeList = (
    <>
      {holes.length > 0 && (
        <div>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your holes
          </div>
          {holes.map((h) => (
            <button
              key={h.itemId}
              onClick={() => router.push(`/rabbithole?item=${h.itemId}`)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left hover:bg-accent/50",
                root?.itemId === h.itemId && "bg-accent",
              )}
            >
              <span className="truncate text-sm font-medium">{h.title}</span>
              <span className="text-xs text-muted-foreground">
                {h.branchCount} branch{h.branchCount === 1 ? "" : "es"} ·{" "}
                {formatRelativeTime(h.lastAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className={holes.length > 0 ? "mt-4" : ""}>
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
      {holes.length === 0 && recent.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">
          Nothing in your Directory yet — save an article, upload a document, or write a note
          first.
        </p>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-1">
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
              <span className="truncate text-sm font-semibold">{root.title}</span>
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
            <ScrollArea className="flex-1">
              <div ref={bodyRef} className="mx-auto max-w-[68ch] px-6 py-8">
                {root.text.trim() ? (
                  root.markdown ? (
                    <div className="prose-reader">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
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

          {/* Branch panel — stacked below on mobile, right column on desktop */}
          <div className="h-[45vh] shrink-0 border-t border-border lg:h-auto lg:w-[440px] lg:border-l lg:border-t-0">
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
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-xl px-6 py-10">
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

"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, CornerDownRight, Loader2, Rabbit, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/app-dialogs";
import { collectSubtreeIds, type RabbitholeLens } from "@/lib/rabbithole/lenses";
import { useRabbithole, type RhNode } from "@/lib/rabbithole/use-rabbithole";
import { DigPopover, type DigTarget } from "@/components/rabbithole/canvas/dig-popover";

export type { RhNode };

/**
 * Rabbithole — select text in the document (or in any answer), ask a question
 * or tap a lens, and the answer opens as a child document you can dig into
 * again. Renders the floating selection popover plus a right-side drawer
 * (mirroring DocQueryPanel) with breadcrumbs and the branch tree. Every branch
 * is persisted server-side and revisitable.
 */
export function Rabbithole({
  itemId,
  rootTitle,
  bodyRef,
  enabled,
  open,
  onOpenChange,
  variant = "drawer",
}: {
  itemId: string;
  rootTitle: string;
  bodyRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "drawer" | "inline";
}) {
  const confirm = useConfirm();
  const rh = useRabbithole(itemId);
  const { nodes, draft, streaming, byId, childrenOf, pathTo, dig, deleteBranch } = rh;

  const [path, setPath] = useState<string[]>([]);
  const [popover, setPopover] = useState<DigTarget | null>(null);

  const panelBodyRef = useRef<HTMLDivElement>(null);

  const currentId = path.length ? path[path.length - 1] : null;
  const current = currentId ? byId.get(currentId) ?? null : null;

  // Reset navigation when the item changes.
  useEffect(() => {
    setPath([]);
    setPopover(null);
  }, [itemId]);

  const stateRef = useRef({ enabled, currentId, streaming, open });
  stateRef.current = { enabled, currentId, streaming, open };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (popover) setPopover(null);
      else if (stateRef.current.open) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, onOpenChange]);

  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if ((e.target as Element)?.closest?.("[data-dig-popover]")) return;
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setPopover(null);
          return;
        }
        const text = sel.toString().replace(/\s+/g, " ").trim();
        if (text.length < 3) {
          setPopover(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        if (el?.closest("textarea, input")) return;

        const s = stateRef.current;
        let parentId: string | null;
        if (panelBodyRef.current?.contains(node)) {
          if (!s.currentId || s.streaming) return;
          parentId = s.currentId;
        } else if (bodyRef.current?.contains(node)) {
          if (!s.enabled || s.streaming) return;
          parentId = null;
        } else {
          setPopover(null);
          return;
        }

        const rect = range.getBoundingClientRect();
        setPopover({
          text: text.slice(0, 2000),
          parentId,
          x: Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180),
          y: Math.min(rect.bottom + 8, window.innerHeight - 140),
        });
      }, 0);
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [bodyRef]);

  const onDig = useCallback(
    async (target: DigTarget, lens: RabbitholeLens | null, q: string) => {
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      onOpenChange(true);
      const id = await dig(target.parentId, target.text, lens, q);
      if (id) setPath([...pathTo(target.parentId), id]);
    },
    [dig, pathTo, onOpenChange],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const doomed = collectSubtreeIds(nodes, id);
      const ok = await confirm({
        title: "Delete this branch?",
        body:
          doomed.length > 1
            ? `This also removes the ${doomed.length - 1} deeper branch${doomed.length === 2 ? "" : "es"} dug from it.`
            : "This cannot be undone.",
        destructive: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      const gone = await deleteBranch(id);
      if (gone) {
        const set = new Set(gone);
        setPath((p) => {
          const cut = p.findIndex((pid) => set.has(pid));
          return cut >= 0 ? p.slice(0, cut) : p;
        });
      }
    },
    [nodes, confirm, deleteBranch],
  );

  const branchList = (parentId: string | null, indent: number): React.ReactNode => {
    const kids = childrenOf(parentId);
    if (kids.length === 0) return null;
    return kids.map((n) => (
      <React.Fragment key={n.id}>
        <div className="group flex items-center gap-1" style={{ paddingLeft: indent * 14 }}>
          <button
            onClick={() => setPath(pathTo(n.id))}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
            title={n.anchorText}
          >
            <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{n.title}</span>
          </button>
          <button
            onClick={() => void onDelete(n.id)}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            title="Delete branch (and everything below it)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {branchList(n.id, indent + 1)}
      </React.Fragment>
    ));
  };

  const view = draft ?? current;
  const viewChildren = !draft && current ? childrenOf(current.id) : [];

  return (
    <>
      {popover && (
        <DigPopover
          target={popover}
          onSubmit={onDig}
          style={{ position: "fixed", left: popover.x, top: popover.y }}
        />
      )}

      {variant === "drawer" && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/40 transition-opacity sm:hidden",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => onOpenChange(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "not-prose flex flex-col bg-background",
          variant === "drawer"
            ? cn(
                "fixed inset-y-0 right-0 z-50 w-full border-l border-border shadow-xl transition-transform duration-200 sm:w-[480px]",
                open ? "translate-x-0" : "translate-x-full",
              )
            : "h-full min-h-0 w-full",
        )}
        aria-hidden={variant === "drawer" ? !open : undefined}
        inert={variant === "drawer" ? !open : undefined}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Rabbit className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Rabbithole</span>
          {(draft || view) && (
            <span className="text-xs text-muted-foreground">
              · {draft ? (draft.parentId ? (byId.get(draft.parentId)?.depth ?? 0) + 1 : 1) : current?.depth}{" "}
              deep
            </span>
          )}
          {variant === "drawer" && (
            <button
              onClick={() => onOpenChange(false)}
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          <button
            onClick={() => {
              if (!streaming) setPath([]);
            }}
            className={cn("max-w-[16ch] truncate hover:text-foreground", path.length === 0 && !draft && "text-foreground")}
            title={rootTitle}
          >
            {rootTitle || "Document"}
          </button>
          {path.map((id) => (
            <span key={id} className="inline-flex min-w-0 items-center gap-1">
              <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              <button
                onClick={() => !streaming && setPath(pathTo(id))}
                className={cn(
                  "max-w-[16ch] truncate hover:text-foreground",
                  id === currentId && !draft && "text-foreground",
                )}
                title={byId.get(id)?.title}
              >
                {byId.get(id)?.title ?? "…"}
              </button>
            </span>
          ))}
          {draft && (
            <span className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3 opacity-50" />
              <span className="italic text-foreground">digging…</span>
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {view ? (
            <div>
              <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
                {view.anchorText.length > 280 ? `${view.anchorText.slice(0, 280)}…` : view.anchorText}
              </blockquote>
              {view.question && <div className="mb-3 text-sm font-medium">{view.question}</div>}
              <div ref={panelBodyRef} className="prose-reader prose-sm max-w-none text-sm">
                {view.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{view.content}</ReactMarkdown>
                ) : (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Digging…
                  </span>
                )}
              </div>

              {!draft && current && (
                <div className="mt-6 border-t border-border pt-3">
                  <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-muted-foreground">
                    {viewChildren.length > 0 ? "Deeper digs from here" : "Select text above to dig deeper"}
                    <button
                      onClick={() => void onDelete(current.id)}
                      className="ml-auto inline-flex items-center gap-1 rounded p-1 normal-case text-muted-foreground hover:text-destructive"
                      title="Delete this branch (and everything below it)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {viewChildren.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setPath(pathTo(n.id))}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                      title={n.anchorText}
                    >
                      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{n.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <Rabbit className="h-8 w-8 opacity-40" />
              <p className="font-medium text-foreground">No branches yet</p>
              <p>
                Select any text in the document, then ask a question or tap a lens — Explain, ELI5,
                Example, Go Deeper. The answer opens here as a new document you can dig into again.
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {nodes.length} branch{nodes.length === 1 ? "" : "es"} in this hole
              </div>
              {branchList(null, 0)}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

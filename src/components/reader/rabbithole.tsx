"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, CornerDownRight, Loader2, Rabbit, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/app-dialogs";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { RABBITHOLE_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import {
  RABBITHOLE_LENSES,
  collectSubtreeIds,
  type RabbitholeLens,
} from "@/lib/rabbithole/lenses";

const MODEL_STORAGE_KEY = "ask.model.v1"; // shared with the Ask tab / DocQueryPanel

function getModel(): string {
  if (typeof window === "undefined") return DEFAULT_CHAT_MODEL;
  return window.localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_CHAT_MODEL;
}

export type RhNode = {
  id: string;
  parentId: string | null;
  anchorText: string;
  question: string;
  lens: string | null;
  title: string;
  content: string;
  depth: number;
  createdAt: string;
};

type Popover = {
  x: number;
  y: number;
  text: string;
  /** null = selection was in the root document; else the node id it was in. */
  parentId: string | null;
};

type Draft = {
  parentId: string | null;
  anchorText: string;
  question: string;
  lens: RabbitholeLens | null;
  content: string;
};

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
}: {
  itemId: string;
  rootTitle: string;
  /** The reading body — selections inside it branch from the root document. */
  bodyRef: React.RefObject<HTMLElement | null>;
  /** Gate for ROOT-document selections (e.g. off while the item is loading). */
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirm();
  const [nodes, setNodes] = useState<RhNode[]>([]);
  const [path, setPath] = useState<string[]>([]); // root → current node ids
  const [draft, setDraft] = useState<Draft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [question, setQuestion] = useState("");

  const popoverRef = useRef<HTMLDivElement>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const currentId = path.length ? path[path.length - 1] : null;
  const current = currentId ? byId.get(currentId) ?? null : null;
  const childrenOf = useCallback(
    (parentId: string | null) => nodes.filter((n) => n.parentId === parentId),
    [nodes],
  );

  // Refs so the document-level mouseup listener stays stable across renders.
  const stateRef = useRef({ enabled, currentId, streaming, open });
  stateRef.current = { enabled, currentId, streaming, open };

  // Load the item's existing hole; reset view state when the item changes.
  useEffect(() => {
    setNodes([]);
    setPath([]);
    setDraft(null);
    setPopover(null);
    abortRef.current?.abort();
    setStreaming(false);
    if (!itemId) return;
    let aborted = false;
    fetch(`/api/rabbithole?itemId=${itemId}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { nodes: RhNode[] }) : null))
      .then((data) => {
        if (!aborted && data) setNodes(data.nodes);
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, [itemId]);

  // Drop any in-flight generation on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Esc: close the popover first, then the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (popover) setPopover(null);
      else if (stateRef.current.open) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, onOpenChange]);

  // Text-selection → popover. One document-level listener; the selection's
  // container decides the branch parent (root body vs the open answer).
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
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
        // Textarea/input selections (edit mode) are not dig targets.
        if (el?.closest("textarea, input")) return;

        const s = stateRef.current;
        let parentId: string | null;
        if (panelBodyRef.current?.contains(node)) {
          if (!s.currentId || s.streaming) return; // can't branch off an unsaved draft
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
        setQuestion("");
      }, 0);
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [bodyRef]);

  /** Breadcrumb path for a node: walk parents up to the root document. */
  const pathTo = useCallback(
    (id: string | null): string[] => {
      const out: string[] = [];
      let cur = id ? byId.get(id) : null;
      let safety = 0;
      while (cur && safety < 32) {
        out.unshift(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
        safety += 1;
      }
      return out;
    },
    [byId],
  );

  async function dig(parentId: string | null, anchorText: string, lens: RabbitholeLens | null, q: string) {
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    onOpenChange(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setDraft({ parentId, anchorText, question: q, lens, content: "" });

    try {
      const res = await fetch("/api/rabbithole", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId,
          parentId,
          anchorText,
          question: q || undefined,
          lens: lens ?? undefined,
          model: getModel(),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        toast.error(msg || `Request failed (${res.status})`);
        setDraft(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const display = displayText(acc);
        setDraft((d) => (d ? { ...d, content: display } : d));
      }

      // Trailing sentinel carries the saved node — no refetch needed.
      const idx = acc.indexOf(RABBITHOLE_SENTINEL);
      if (idx >= 0) {
        try {
          const payload = JSON.parse(acc.slice(idx + RABBITHOLE_SENTINEL.length)) as {
            id: string;
            parentId: string | null;
            title: string;
            depth: number;
          };
          const saved: RhNode = {
            id: payload.id,
            parentId: payload.parentId,
            anchorText,
            question: q,
            lens,
            title: payload.title,
            content: displayText(acc),
            depth: payload.depth,
            createdAt: new Date().toISOString(),
          };
          setNodes((ns) => [...ns, saved]);
          setPath([...pathTo(parentId), payload.id]);
          setDraft(null);
        } catch {
          /* keep the draft visible; it just won't be branchable */
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Request failed");
      }
      setDraft(null);
    } finally {
      setStreaming(false);
    }
  }

  async function deleteBranch(id: string) {
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
    try {
      const res = await fetch(`/api/rabbithole/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text().catch(() => `Request failed (${res.status})`));
      const gone = new Set(doomed);
      setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
      setPath((p) => {
        const cut = p.findIndex((pid) => gone.has(pid));
        return cut >= 0 ? p.slice(0, cut) : p;
      });
      toast.success("Branch deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function submitPopover(lens: RabbitholeLens | null) {
    if (!popover) return;
    const q = question.trim();
    if (!lens && !q) return;
    void dig(popover.parentId, popover.text, lens, q);
  }

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
            onClick={() => void deleteBranch(n.id)}
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
      {/* Selection popover */}
      {popover && (
        <div
          ref={popoverRef}
          className="fixed z-[60] w-[340px] -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-lg"
          style={{ left: popover.x, top: popover.y }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Rabbit className="h-3.5 w-3.5" />
            Dig into &ldquo;{popover.text.length > 40 ? `${popover.text.slice(0, 40)}…` : popover.text}&rdquo;
          </div>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {RABBITHOLE_LENSES.map((l) => (
              <button
                key={l.key}
                onClick={() => submitPopover(l.key)}
                className="rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                title={l.prompt}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitPopover(null);
                }
              }}
              placeholder="Or ask your own question…"
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
            />
            <button
              onClick={() => submitPopover(null)}
              disabled={!question.trim()}
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="Ask"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Drawer panel — mirrors DocQueryPanel (mobile scrim, right drawer, inert when closed) */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity sm:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "not-prose fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-xl transition-transform duration-200 sm:w-[480px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
        inert={!open}
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
          <button
            onClick={() => onOpenChange(false)}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumbs: root document → node path */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          <button
            onClick={() => {
              if (!streaming) {
                setDraft(null);
                setPath([]);
              }
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
              {/* The passage this branch was dug from */}
              <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
                {view.anchorText.length > 280 ? `${view.anchorText.slice(0, 280)}…` : view.anchorText}
              </blockquote>
              {view.question && (
                <div className="mb-3 text-sm font-medium">{view.question}</div>
              )}
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
                      onClick={() => void deleteBranch(current.id)}
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

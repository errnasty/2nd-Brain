# Rabbithole Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an infinite pan/zoom canvas view to the Rabbithole tab where the root document and every answer branch render as real DOM cards, selecting text in any card digs a new streaming child card, and edges draw from the exact selected phrase.

**Architecture:** A hand-rolled canvas — a `viewport` div (overflow hidden) holding an SVG edge layer plus a CSS-transformed `world` div of absolutely-positioned React cards. Pan/zoom camera lives in refs and is applied imperatively (no React re-render per frame). Node/streaming/mutation logic is extracted from `reader/rabbithole.tsx` into a shared `useRabbithole` hook so the split view and the canvas share one instance. Layout is a pure tidy-tree function.

**Tech Stack:** Next.js (App Router) client components, React 19, TypeScript, Tailwind, `react-markdown` + `remark-gfm`, Vitest for unit tests. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-rabbithole-canvas-design.md`

---

## File Structure

**Create:**
- `src/lib/rabbithole/layout.ts` — pure tidy-tree layout: `(nodes, sizes, overrides) → Map<id, {x,y}>`.
- `src/lib/rabbithole/layout.test.ts` — Vitest unit tests for layout.
- `src/lib/rabbithole/use-rabbithole.ts` — shared hook: node fetch, dig/stream, delete-subtree, derived helpers.
- `src/components/rabbithole/canvas/rabbithole-canvas.tsx` — canvas view (viewport + world + toolbar), consumes the hook + selection popover.
- `src/components/rabbithole/canvas/branch-card.tsx` — one node card (root or branch).
- `src/components/rabbithole/canvas/edges.tsx` — SVG edge layer, anchor-aware.
- `src/components/rabbithole/canvas/use-camera.ts` — pan/zoom camera in refs, imperative transform, gesture handlers.
- `src/components/rabbithole/canvas/dig-popover.tsx` — the selection popover, extracted so both split + canvas reuse it.

**Modify:**
- `src/components/reader/rabbithole.tsx` — consume `useRabbithole` + `DigPopover` instead of local state (behavior unchanged).
- `src/components/rabbithole/rabbithole-shell.tsx` — add `[Canvas | Split]` toggle; render canvas or the current split.

---

## Task 1: Pure tidy-tree layout

**Files:**
- Create: `src/lib/rabbithole/layout.ts`
- Test: `src/lib/rabbithole/layout.test.ts`

The layout takes the node list (each with `id` and `parentId`), a size map (`id → {w,h}`), and a set of collapsed ids. It returns a position map. Root(s) at x=0; each generation is placed one column to the right (`x = depth * (COL_W)`); siblings stack vertically with `ROW_GAP`; a parent is vertically centered against its visible subtree span. Collapsed nodes contribute their own box but none of their descendants. Nodes are `parentId: null` rooted (there can be several `parentId===null` "root document" branches — treat a synthetic root, id `"__root__"`, as their shared parent so the doc card is the trunk).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/rabbithole/layout.test.ts
import { describe, it, expect } from "vitest";
import { layoutTree, ROOT_ID, type LayoutNode } from "./layout";

const size = { w: 320, h: 200 };
const sizes = (ids: string[]) => new Map(ids.map((id) => [id, size]));

describe("layoutTree", () => {
  it("places the synthetic root at origin and a single child to its right", () => {
    const nodes: LayoutNode[] = [{ id: "a", parentId: null }];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a"]), new Set());
    expect(pos.get(ROOT_ID)).toEqual({ x: 0, y: 0 });
    expect(pos.get("a")!.x).toBeGreaterThan(0);
    expect(pos.get("a")!.y).toBe(0);
  });

  it("stacks siblings vertically without overlap", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "b"]), new Set());
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    const gap = Math.abs(pos.get("b")!.y - pos.get("a")!.y);
    expect(gap).toBeGreaterThanOrEqual(size.h);
  });

  it("hides descendants of a collapsed node", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "a1", parentId: "a" },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "a1"]), new Set(["a"]));
    expect(pos.has("a")).toBe(true);
    expect(pos.has("a1")).toBe(false);
  });

  it("gives a parent's two subtrees non-overlapping vertical bands", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
      { id: "a1", parentId: "a" },
      { id: "a2", parentId: "a" },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "b", "a1", "a2"]), new Set());
    // b sits below a's whole subtree (a1, a2), so b.y exceeds a2.y.
    expect(pos.get("b")!.y).toBeGreaterThan(pos.get("a2")!.y);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rabbithole/layout.test.ts`
Expected: FAIL — `Cannot find module './layout'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/rabbithole/layout.ts
// Pure tidy-tree layout for the Rabbithole canvas. No DOM, no React — takes the
// node parent links, each card's measured size, and the set of collapsed ids,
// and returns absolute world positions. A synthetic ROOT_ID stands in as the
// shared parent of every parentId===null branch so the root document card is
// the trunk of the tree.

export const ROOT_ID = "__root__";

export type LayoutNode = { id: string; parentId: string | null };
export type Size = { w: number; h: number };
export type Pos = { x: number; y: number };

const COL_GAP = 120; // horizontal space between a card's right edge and its children
const ROW_GAP = 40; // vertical space between sibling subtrees

/**
 * @param nodes    every branch (root document excluded — it is ROOT_ID)
 * @param sizes    measured card sizes, keyed by node id and ROOT_ID
 * @param collapsed ids whose subtrees are hidden
 * @returns position map (world coords, top-left of each card); collapsed
 *          descendants are absent from the map
 */
export function layoutTree(
  nodes: LayoutNode[],
  sizes: Map<string, Size>,
  collapsed: Set<string>,
): Map<string, Pos> {
  const DEFAULT: Size = { w: 320, h: 200 };
  const sizeOf = (id: string) => sizes.get(id) ?? DEFAULT;

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    const parent = n.parentId ?? ROOT_ID;
    const list = childrenOf.get(parent) ?? [];
    list.push(n.id);
    childrenOf.set(parent, list);
  }

  const pos = new Map<string, Pos>();

  // Place `id` with its top-left column at `x`, packing its subtree into a
  // vertical band starting at `top`. Returns the band's height so the caller
  // can stack the next sibling below it. The node is vertically centered
  // against its children's combined band.
  function place(id: string, x: number, top: number): number {
    const size = sizeOf(id);
    const kids = collapsed.has(id) ? [] : childrenOf.get(id) ?? [];

    if (kids.length === 0) {
      pos.set(id, { x, y: top });
      return size.h;
    }

    const childX = x + size.w + COL_GAP;
    let childTop = top;
    const childCenters: number[] = [];
    for (const kid of kids) {
      const h = place(kid, childX, childTop);
      childCenters.push(childTop + h / 2);
      childTop += h + ROW_GAP;
    }
    const bandBottom = childTop - ROW_GAP;
    const bandHeight = bandBottom - top;

    // Center this card against the span of its children.
    const mid = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    pos.set(id, { x, y: mid - size.h / 2 });

    // The band must cover both the children and this (possibly taller) card.
    const selfTop = mid - size.h / 2;
    const selfBottom = mid + size.h / 2;
    const bandTop = Math.min(top, selfTop);
    const realBottom = Math.max(bandBottom, selfBottom);
    // Shift so the band starts exactly at `top` (keep children/self relative).
    const shift = top - bandTop;
    if (shift !== 0) {
      shiftSubtree(id, shift);
    }
    return Math.max(bandHeight, realBottom - bandTop);
  }

  function shiftSubtree(id: string, dy: number) {
    const p = pos.get(id);
    if (p) pos.set(id, { x: p.x, y: p.y + dy });
    if (collapsed.has(id)) return;
    for (const kid of childrenOf.get(id) ?? []) shiftSubtree(kid, dy);
  }

  place(ROOT_ID, 0, 0);
  return pos;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rabbithole/layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rabbithole/layout.ts src/lib/rabbithole/layout.test.ts
git commit -m "feat(rabbithole): pure tidy-tree layout for canvas"
```

---

## Task 2: Extract the shared `useRabbithole` hook

Move the data/stream engine out of `reader/rabbithole.tsx` verbatim (logic unchanged) into a hook both views share. This is a refactor — no behavior change — so the guard test is that the existing app still builds and the split view still works.

**Files:**
- Create: `src/lib/rabbithole/use-rabbithole.ts`
- Modify: `src/components/reader/rabbithole.tsx`

- [ ] **Step 1: Create the hook**

```typescript
// src/lib/rabbithole/use-rabbithole.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { RABBITHOLE_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import { collectSubtreeIds, type RabbitholeLens } from "@/lib/rabbithole/lenses";

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

export type RhDraft = {
  parentId: string | null;
  anchorText: string;
  question: string;
  lens: RabbitholeLens | null;
  content: string;
};

/**
 * The Rabbithole data engine, shared by the reader drawer, the split-view
 * branch panel, and the canvas. Owns node state, the streaming dig flow, and
 * subtree deletion. View components add their own selection/navigation UI.
 */
export function useRabbithole(itemId: string) {
  const [nodes, setNodes] = useState<RhNode[]>([]);
  const [draft, setDraft] = useState<RhDraft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useCallback(
    (parentId: string | null) => nodes.filter((n) => n.parentId === parentId),
    [nodes],
  );

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

  // Load the item's existing hole; reset when the item changes.
  useEffect(() => {
    setNodes([]);
    setDraft(null);
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

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Dig a branch off `parentId` from `anchorText`. Streams the answer into the
   * draft, then swaps it into `nodes` when the trailing sentinel lands.
   * Resolves with the saved node's id (or null on failure/abort) so a caller
   * can navigate or focus it.
   */
  const dig = useCallback(
    async (
      parentId: string | null,
      anchorText: string,
      lens: RabbitholeLens | null,
      q: string,
    ): Promise<string | null> => {
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
          return null;
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

        const idx = acc.indexOf(RABBITHOLE_SENTINEL);
        if (idx >= 0) {
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
          setDraft(null);
          return payload.id;
        }
        return null;
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          toast.error(err instanceof Error ? err.message : "Request failed");
        }
        setDraft(null);
        return null;
      } finally {
        setStreaming(false);
      }
    },
    [itemId],
  );

  /** Delete a branch and its whole subtree. Returns the removed ids. */
  const deleteBranch = useCallback(
    async (id: string): Promise<string[] | null> => {
      const doomed = collectSubtreeIds(nodes, id);
      try {
        const res = await fetch(`/api/rabbithole/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text().catch(() => `Request failed (${res.status})`));
        const gone = new Set(doomed);
        setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
        toast.success("Branch deleted");
        return doomed;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
        return null;
      }
    },
    [nodes],
  );

  return {
    nodes,
    draft,
    streaming,
    byId,
    childrenOf,
    pathTo,
    dig,
    deleteBranch,
    setNodes,
  };
}
```

- [ ] **Step 2: Rewrite `reader/rabbithole.tsx` to consume the hook**

Replace the state block and the `dig`/`deleteBranch`/`pathTo` definitions with the hook. Keep the selection popover, breadcrumb, path navigation, and rendering exactly as they are. The full new file:

```tsx
// src/components/reader/rabbithole.tsx
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
```

> NOTE: This step depends on `DigPopover` from Task 3. Implement Task 3 first, or stub `DigPopover` and wire it here after Task 3. The subagent executing this plan should do Task 3 before Task 2's Step 2.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Manual smoke of split view**

Run: `npm run dev`, open `/rabbithole?item=<an existing hole>`, select text, dig, delete a branch.
Expected: identical behavior to before.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rabbithole/use-rabbithole.ts src/components/reader/rabbithole.tsx
git commit -m "refactor(rabbithole): extract shared useRabbithole hook"
```

---

## Task 3: Extract `DigPopover`

The selection popover is identical in split and canvas. Pull it into its own component. Split-view text (Task 2) already references it.

**Files:**
- Create: `src/components/rabbithole/canvas/dig-popover.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/rabbithole/canvas/dig-popover.tsx
"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Rabbit, Send } from "lucide-react";
import { RABBITHOLE_LENSES, type RabbitholeLens } from "@/lib/rabbithole/lenses";

/** Where a dig was requested from: the selected text and the parent node
 *  (null = the selection was in the root document). x/y are viewport coords for
 *  the fixed-position variant; the canvas variant positions via `style`. */
export type DigTarget = {
  text: string;
  parentId: string | null;
  x: number;
  y: number;
};

/**
 * The floating "dig into …" popover: lens chips plus a free-text question.
 * Shared by the reader drawer, the split-view panel, and the canvas.
 */
export function DigPopover({
  target,
  onSubmit,
  style,
}: {
  target: DigTarget;
  onSubmit: (target: DigTarget, lens: RabbitholeLens | null, question: string) => void;
  style?: React.CSSProperties;
}) {
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuestion("");
    inputRef.current?.focus();
  }, [target]);

  const submit = (lens: RabbitholeLens | null) => {
    const q = question.trim();
    if (!lens && !q) return;
    onSubmit(target, lens, q);
  };

  return (
    <div
      data-dig-popover
      className="z-[60] w-[340px] -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-lg"
      style={style}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Rabbit className="h-3.5 w-3.5" />
        Dig into &ldquo;{target.text.length > 40 ? `${target.text.slice(0, 40)}…` : target.text}&rdquo;
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {RABBITHOLE_LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => submit(l.key)}
            className="rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
            title={l.prompt}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(null);
            }
          }}
          placeholder="Or ask your own question…"
          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          onClick={() => submit(null)}
          disabled={!question.trim()}
          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Ask"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (component is self-contained; consumers land in Task 2/5).

- [ ] **Step 3: Commit**

```bash
git add src/components/rabbithole/canvas/dig-popover.tsx
git commit -m "feat(rabbithole): extract shared DigPopover component"
```

---

## Task 4: Camera hook (pan/zoom in refs)

Imperative camera: pan/zoom state in a ref, applied to the world div's transform. Ported gesture semantics from the reference: wheel = pan, ctrl+wheel = zoom-toward-cursor, gesture keeps the target it started on.

**Files:**
- Create: `src/components/rabbithole/canvas/use-camera.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/components/rabbithole/canvas/use-camera.ts
"use client";

import { useCallback, useEffect, useRef } from "react";

export type Camera = { x: number; y: number; scale: number };

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Imperative pan/zoom camera for the canvas. Holds the transform in a ref and
 * writes it straight to `worldRef` / `edgesRef` — no React re-render per frame.
 * Wheel pans; ctrl/⌘+wheel zooms toward the cursor. A wheel gesture that begins
 * inside a scrollable card keeps scrolling that card until it pauses.
 *
 * @param viewportRef the overflow-hidden frame
 * @param worldRef    the transformed layer holding the cards
 * @param edgesRef    the SVG layer (kept in lockstep with the world)
 * @param onChange    called after every transform write (e.g. persist + redraw)
 */
export function useCamera(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  worldRef: React.RefObject<HTMLDivElement | null>,
  edgesRef: React.RefObject<SVGSVGElement | null>,
  onChange?: (cam: Camera) => void,
) {
  const cam = useRef<Camera>({ x: 0, y: 0, scale: 1 });

  const apply = useCallback(() => {
    const t = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.scale})`;
    if (worldRef.current) worldRef.current.style.transform = t;
    if (edgesRef.current) edgesRef.current.style.transform = t;
    onChange?.(cam.current);
  }, [worldRef, edgesRef, onChange]);

  const setCamera = useCallback(
    (next: Partial<Camera>) => {
      cam.current = { ...cam.current, ...next };
      if (next.scale != null) cam.current.scale = clampScale(cam.current.scale);
      apply();
    },
    [apply],
  );

  const getCamera = useCallback(() => cam.current, []);

  /** Screen (viewport-relative px) → world coords. */
  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - cam.current.x) / cam.current.scale,
      y: (sy - cam.current.y) / cam.current.scale,
    }),
    [],
  );

  /** Zoom toward a viewport point, keeping that world point under the cursor. */
  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const next = clampScale(cam.current.scale * factor);
      if (next === cam.current.scale) return;
      const w = screenToWorld(sx, sy);
      cam.current.scale = next;
      cam.current.x = sx - w.x * next;
      cam.current.y = sy - w.y * next;
      apply();
    },
    [apply, screenToWorld],
  );

  /** Center the camera on a world rectangle (frame-all / reveal). */
  const frameRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, pad = 80) => {
      const vp = viewportRef.current;
      if (!vp || rect.w <= 0 || rect.h <= 0) return;
      const scale = clampScale(
        Math.min((vp.clientWidth - pad * 2) / rect.w, (vp.clientHeight - pad * 2) / rect.h, 1),
      );
      cam.current.scale = scale;
      cam.current.x = vp.clientWidth / 2 - (rect.x + rect.w / 2) * scale;
      cam.current.y = vp.clientHeight / 2 - (rect.y + rect.h / 2) * scale;
      apply();
    },
    [viewportRef, apply],
  );

  // Wheel: pan by default, ctrl/⌘+wheel = zoom-at-cursor. A gesture that starts
  // inside a scrollable card stays a card-scroll until a >180ms pause.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let kind: "pan" | "card" | null = null;
    let card: HTMLElement | null = null;
    let ts = 0;

    const canScroll = (el: HTMLElement | null, dy: number) => {
      while (el && el !== vp) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
          if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        kind = null;
        zoomAt(e.clientX - vp.getBoundingClientRect().left, e.clientY - vp.getBoundingClientRect().top, Math.exp(-e.deltaY * 0.01));
        return;
      }
      if (!kind || e.timeStamp - ts > 180) {
        card = canScroll(e.target as HTMLElement, e.deltaY);
        kind = card ? "card" : "pan";
      }
      ts = e.timeStamp;
      if (kind === "pan") {
        e.preventDefault();
        cam.current.x -= e.deltaX;
        cam.current.y -= e.deltaY;
        apply();
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [viewportRef, zoomAt, apply]);

  return { getCamera, setCamera, screenToWorld, zoomAt, frameRect, apply };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/rabbithole/canvas/use-camera.ts
git commit -m "feat(rabbithole): imperative pan/zoom camera hook"
```

---

## Task 5: BranchCard, edges, and the canvas view

Assemble the canvas. Cards are absolutely positioned in the world layer; a background-drag pans; SVG edges connect parents to children (start = anchor span rect if found, else the parent card's right-edge midpoint); selecting text in any card opens `DigPopover`; digging streams a child card in.

**Files:**
- Create: `src/components/rabbithole/canvas/branch-card.tsx`
- Create: `src/components/rabbithole/canvas/edges.tsx`
- Create: `src/components/rabbithole/canvas/rabbithole-canvas.tsx`

- [ ] **Step 1: Write `branch-card.tsx`**

```tsx
// src/components/rabbithole/canvas/branch-card.tsx
"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, GripHorizontal, Loader2, PanelRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const CARD_W = 340;

/** One card in the canvas world. Root (`isRoot`) shows the source document;
 *  branches show the streamed answer. Position is applied by the parent via
 *  absolute left/top. The header is the drag handle. */
export function BranchCard({
  id,
  isRoot,
  title,
  anchorText,
  question,
  content,
  streaming,
  collapsed,
  childCount,
  onMeasure,
  onDragStart,
  onToggleCollapse,
  onOpenInSplit,
  onDelete,
  cardRef,
  bodyRef,
}: {
  id: string;
  isRoot: boolean;
  title: string;
  anchorText?: string;
  question?: string;
  content: string;
  streaming?: boolean;
  collapsed?: boolean;
  childCount: number;
  onMeasure: (id: string, w: number, h: number) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onToggleCollapse?: (id: string) => void;
  onOpenInSplit?: (id: string) => void;
  onDelete?: (id: string) => void;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
  bodyRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const localRef = useRef<HTMLDivElement>(null);

  // Report measured size to the layout engine whenever content changes.
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onMeasure(id, el.offsetWidth, el.offsetHeight);
    });
    ro.observe(el);
    onMeasure(id, el.offsetWidth, el.offsetHeight);
    return () => ro.disconnect();
  }, [id, onMeasure, content, collapsed]);

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        cardRef(id, el);
      }}
      className={cn(
        "absolute flex flex-col rounded-lg border bg-card shadow-sm",
        isRoot ? "border-primary/40" : "border-border",
      )}
      style={{ width: CARD_W }}
      data-card={id}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 rounded-t-lg border-b border-border bg-muted/40 px-2 py-1.5 active:cursor-grabbing"
        onPointerDown={(e) => onDragStart(id, e)}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold" title={title}>
          {title}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {childCount > 0 && onToggleCollapse && (
            <button
              onClick={() => onToggleCollapse(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title={collapsed ? `Expand ${childCount} branch${childCount === 1 ? "" : "es"}` : "Collapse"}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          {onOpenInSplit && (
            <button
              onClick={() => onOpenInSplit(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Open in split view"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          )}
          {!isRoot && onDelete && (
            <button
              onClick={() => onDelete(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              title="Delete branch (and everything below it)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={(el) => bodyRef(id, el)}
        className="max-h-[420px] overflow-y-auto px-3 py-2"
      >
        {!isRoot && anchorText && (
          <blockquote className="mb-2 border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
            {anchorText.length > 200 ? `${anchorText.slice(0, 200)}…` : anchorText}
          </blockquote>
        )}
        {!isRoot && question && <div className="mb-2 text-xs font-medium">{question}</div>}
        <div className="prose-reader prose-sm max-w-none text-sm">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : streaming ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Digging…
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `edges.tsx`**

```tsx
// src/components/rabbithole/canvas/edges.tsx
"use client";

import * as React from "react";
import { forwardRef } from "react";

export type Edge = {
  childId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  highlighted: boolean;
};

/** SVG layer drawing a smooth bezier from each parent anchor to its child card,
 *  plus an anchor dot at the start. Sits under the world transform (same
 *  translate/scale), so world coords map 1:1. */
export const Edges = forwardRef<SVGSVGElement, { edges: Edge[] }>(function Edges({ edges }, ref) {
  return (
    <svg
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 origin-top-left overflow-visible"
      style={{ width: 1, height: 1 }}
    >
      {edges.map((e) => {
        const dx = Math.max(40, Math.abs(e.end.x - e.start.x) / 2);
        const d = `M ${e.start.x} ${e.start.y} C ${e.start.x + dx} ${e.start.y}, ${e.end.x - dx} ${e.end.y}, ${e.end.x} ${e.end.y}`;
        return (
          <g key={e.childId} className={e.highlighted ? "text-primary" : "text-border"}>
            <path d={d} fill="none" stroke="currentColor" strokeWidth={e.highlighted ? 2 : 1.5} />
            <circle cx={e.start.x} cy={e.start.y} r={3} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
});
```

- [ ] **Step 3: Write `rabbithole-canvas.tsx`**

```tsx
// src/components/rabbithole/canvas/rabbithole-canvas.tsx
"use client";

import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Frame, Maximize2, Minus, Plus, Rabbit } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialogs";
import { collectSubtreeIds, type RabbitholeLens } from "@/lib/rabbithole/lenses";
import { layoutTree, ROOT_ID, type Pos, type Size } from "@/lib/rabbithole/layout";
import { useRabbithole } from "@/lib/rabbithole/use-rabbithole";
import { BranchCard, CARD_W } from "./branch-card";
import { DigPopover, type DigTarget } from "./dig-popover";
import { Edges, type Edge } from "./edges";
import { useCamera } from "./use-camera";

/**
 * The Rabbithole canvas: the root document plus every branch as draggable DOM
 * cards on an infinite pan/zoom surface. Select text in any card to dig; the
 * answer streams into a new child card with an edge from the selected phrase.
 */
export function RabbitholeCanvas({
  itemId,
  rootTitle,
  rootText,
  onOpenInSplit,
}: {
  itemId: string;
  rootTitle: string;
  rootText: string;
  onOpenInSplit: (nodeId: string | null) => void;
}) {
  const confirm = useConfirm();
  const rh = useRabbithole(itemId);
  const { nodes, draft, streaming, byId, childrenOf, dig, deleteBranch } = rh;

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const edgesSvgRef = useRef<SVGSVGElement>(null);

  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const bodyEls = useRef(new Map<string, HTMLDivElement>());
  const [sizes, setSizes] = useState<Map<string, Size>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverrides, setDragOverrides] = useState<Map<string, Pos>>(() => loadPositions(itemId));
  const [popover, setPopover] = useState<(DigTarget & { screenX: number; screenY: number }) | null>(null);
  const [hoveredChild, setHoveredChild] = useState<string | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);

  const { getCamera, setCamera, screenToWorld, zoomAt, frameRect, apply } = useCamera(
    viewportRef,
    worldRef,
    edgesSvgRef,
    () => saveView(itemId, getCamera()),
  );

  // Draft (streaming) card is a virtual node so it lays out and edges to its parent.
  const allForLayout = useMemo(() => {
    const list = nodes.map((n) => ({ id: n.id, parentId: n.parentId }));
    if (draft) list.push({ id: "__draft__", parentId: draft.parentId });
    return list;
  }, [nodes, draft]);

  // Positions: tidy-tree, then apply per-node drag overrides.
  const positions = useMemo(() => {
    const base = layoutTree(allForLayout, sizes, collapsed);
    if (dragOverrides.size) {
      for (const [id, p] of dragOverrides) if (base.has(id)) base.set(id, p);
    }
    return base;
  }, [allForLayout, sizes, collapsed, dragOverrides]);

  const onMeasure = useCallback((id: string, w: number, h: number) => {
    setSizes((prev) => {
      const cur = prev.get(id);
      if (cur && cur.w === w && cur.h === h) return prev;
      const next = new Map(prev);
      next.set(id, { w, h });
      return next;
    });
  }, []);

  const cardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);
  const bodyRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) bodyEls.current.set(id, el);
    else bodyEls.current.delete(id);
  }, []);

  const hidden = useMemo(() => {
    const set = new Set<string>();
    for (const c of collapsed) for (const id of collectSubtreeIds(nodes, c)) if (id !== c) set.add(id);
    return set;
  }, [collapsed, nodes]);

  // Recompute edge geometry: start at the anchor span inside the parent body if
  // we can find it, else the parent card's right-edge midpoint. Runs after
  // layout/scroll/stream via rAF.
  const rafRef = useRef(0);
  const scheduleEdges = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const out: Edge[] = [];
      const parentOf = (childId: string, parentId: string | null) => {
        const pid = parentId ?? ROOT_ID;
        const pPos = positions.get(pid);
        const cPos = positions.get(childId);
        if (!pPos || !cPos) return;
        const pSize = sizes.get(pid) ?? { w: CARD_W, h: 200 };
        const cSize = sizes.get(childId) ?? { w: CARD_W, h: 200 };
        const start = anchorPoint(pid, childId, pPos, pSize) ?? {
          x: pPos.x + pSize.w,
          y: pPos.y + pSize.h / 2,
        };
        out.push({
          childId,
          start,
          end: { x: cPos.x, y: cPos.y + cSize.h / 2 },
          highlighted: hoveredChild === childId,
        });
      };
      for (const n of nodes) {
        if (hidden.has(n.id) || collapsed.has(n.parentId ?? "")) continue;
        parentOf(n.id, n.parentId);
      }
      if (draft) parentOf("__draft__", draft.parentId);
      setEdges(out);
    });
  }, [nodes, draft, positions, sizes, hidden, collapsed, hoveredChild]);

  // Find the anchor text rect inside a parent card body → world coords.
  const anchorPoint = useCallback(
    (parentId: string, childId: string, pPos: Pos, pSize: Size) => {
      const node = childId === "__draft__" ? null : byId.get(childId);
      const anchor = node?.anchorText ?? (draft && childId === "__draft__" ? draft.anchorText : null);
      const body = bodyEls.current.get(parentId);
      if (!anchor || !body) return null;
      const found = findTextRect(body, anchor);
      if (!found) return null;
      const bodyRect = body.getBoundingClientRect();
      const cam = getCamera();
      // Offset of the rect within the card, in world units (undo camera scale).
      const offX = (found.right - bodyRect.left) / cam.scale;
      const offY = (found.top + found.height / 2 - bodyRect.top) / cam.scale;
      // Body starts below the header; approximate the card-local origin.
      const cardEl = cardEls.current.get(parentId);
      const cardRect = cardEl?.getBoundingClientRect();
      const headerH = cardRect ? (bodyRect.top - cardRect.top) / cam.scale : 34;
      return { x: pPos.x + Math.min(offX, pSize.w), y: pPos.y + headerH + offY };
    },
    [byId, draft, getCamera],
  );

  useLayoutEffect(() => {
    scheduleEdges();
  }, [scheduleEdges, positions]);

  // Frame the whole tree on first mount / item change (unless we have a saved view).
  const framedFor = useRef<string>("");
  useEffect(() => {
    if (framedFor.current === itemId) return;
    if (!sizes.size) return; // wait for first measure
    framedFor.current = itemId;
    const saved = loadView(itemId);
    if (saved) setCamera(saved);
    else frameAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, sizes.size]);

  const worldBounds = useCallback(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, p] of positions) {
      if (hidden.has(id)) continue;
      const s = sizes.get(id) ?? { w: CARD_W, h: 200 };
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [positions, sizes, hidden]);

  const frameAll = useCallback(() => {
    const b = worldBounds();
    if (b) frameRect(b);
  }, [worldBounds, frameRect]);

  // Background drag = pan.
  const panState = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-card]")) return;
    setPopover(null);
    const cam = getCamera();
    panState.current = { x: cam.x, y: cam.y, cx: e.clientX, cy: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onBackgroundPointerMove = (e: React.PointerEvent) => {
    const p = panState.current;
    if (!p) return;
    setCamera({ x: p.x + (e.clientX - p.cx), y: p.y + (e.clientY - p.cy) });
  };
  const onBackgroundPointerUp = (e: React.PointerEvent) => {
    panState.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
  };

  // Card header drag = move that card (persist override).
  const cardDrag = useRef<{ id: string; x: number; y: number; cx: number; cy: number } | null>(null);
  const onCardDragStart = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const pos = positions.get(id);
    if (!pos) return;
    cardDrag.current = { id, x: pos.x, y: pos.y, cx: e.clientX, cy: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const d = cardDrag.current;
      if (!d) return;
      const cam = getCamera();
      const nx = d.x + (ev.clientX - d.cx) / cam.scale;
      const ny = d.y + (ev.clientY - d.cy) / cam.scale;
      setDragOverrides((prev) => new Map(prev).set(id, { x: nx, y: ny }));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      cardDrag.current = null;
      savePositions(itemId, dragOverridesRef.current);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const dragOverridesRef = useRef(dragOverrides);
  dragOverridesRef.current = dragOverrides;

  // Text selection inside a card → popover.
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if ((e.target as Element)?.closest?.("[data-dig-popover]")) return;
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setPopover(null); return; }
        const text = sel.toString().replace(/\s+/g, " ").trim();
        if (text.length < 3) { setPopover(null); return; }
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const cardEl = el?.closest("[data-card]") as HTMLElement | null;
        if (!cardEl || streaming) { setPopover(null); return; }
        const cardId = cardEl.getAttribute("data-card")!;
        const parentId = cardId === ROOT_ID ? null : cardId;
        const rect = range.getBoundingClientRect();
        setPopover({
          text: text.slice(0, 2000),
          parentId,
          x: rect.left + rect.width / 2,
          y: rect.bottom + 8,
          screenX: rect.left + rect.width / 2,
          screenY: rect.bottom + 8,
        });
      }, 0);
    }
    const vp = viewportRef.current;
    vp?.addEventListener("mouseup", onMouseUp);
    return () => vp?.removeEventListener("mouseup", onMouseUp);
  }, [streaming]);

  const onDig = useCallback(
    async (target: DigTarget, lens: RabbitholeLens | null, q: string) => {
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      await dig(target.parentId, target.text, lens, q);
      // Reveal happens via the layout/edge effects once the node lands.
    },
    [dig],
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
      await deleteBranch(id);
    },
    [nodes, confirm, deleteBranch],
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Redraw edges when a card body scrolls.
  useEffect(() => {
    const handler = () => scheduleEdges();
    const els = Array.from(bodyEls.current.values());
    els.forEach((el) => el.addEventListener("scroll", handler, { passive: true }));
    return () => els.forEach((el) => el.removeEventListener("scroll", handler));
  }, [scheduleEdges, nodes, draft]);

  const rootContent = rootText;
  const draftNode = draft
    ? {
        id: "__draft__",
        isRoot: false,
        title: "Digging…",
        anchorText: draft.anchorText,
        question: draft.question,
        content: draft.content,
      }
    : null;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-muted/20">
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-none overflow-hidden"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onBackgroundPointerMove}
        onPointerUp={onBackgroundPointerUp}
      >
        <Edges ref={edgesSvgRef} edges={edges} />
        <div ref={worldRef} className="absolute left-0 top-0 origin-top-left">
          {/* Root document card */}
          <div style={{ position: "absolute", left: positions.get(ROOT_ID)?.x ?? 0, top: positions.get(ROOT_ID)?.y ?? 0 }}>
            <BranchCard
              id={ROOT_ID}
              isRoot
              title={rootTitle || "Document"}
              content={rootContent}
              childCount={childrenOf(null).length}
              collapsed={collapsed.has(ROOT_ID)}
              onMeasure={onMeasure}
              onDragStart={onCardDragStart}
              onToggleCollapse={toggleCollapse}
              onOpenInSplit={() => onOpenInSplit(null)}
              cardRef={cardRef}
              bodyRef={bodyRef}
            />
          </div>

          {/* Branch cards */}
          {nodes.map((n) => {
            if (hidden.has(n.id)) return null;
            const p = positions.get(n.id);
            if (!p) return null;
            return (
              <div
                key={n.id}
                style={{ position: "absolute", left: p.x, top: p.y }}
                onMouseEnter={() => { setHoveredChild(n.id); scheduleEdges(); }}
                onMouseLeave={() => { setHoveredChild((h) => (h === n.id ? null : h)); scheduleEdges(); }}
              >
                <BranchCard
                  id={n.id}
                  isRoot={false}
                  title={n.title}
                  anchorText={n.anchorText}
                  question={n.question}
                  content={n.content}
                  childCount={childrenOf(n.id).length}
                  collapsed={collapsed.has(n.id)}
                  onMeasure={onMeasure}
                  onDragStart={onCardDragStart}
                  onToggleCollapse={toggleCollapse}
                  onOpenInSplit={onOpenInSplit}
                  onDelete={onDelete}
                  cardRef={cardRef}
                  bodyRef={bodyRef}
                />
              </div>
            );
          })}

          {/* Streaming draft card */}
          {draftNode && positions.get("__draft__") && (
            <div style={{ position: "absolute", left: positions.get("__draft__")!.x, top: positions.get("__draft__")!.y }}>
              <BranchCard
                id="__draft__"
                isRoot={false}
                title={draftNode.title}
                anchorText={draftNode.anchorText}
                question={draftNode.question}
                content={draftNode.content}
                streaming
                childCount={0}
                onMeasure={onMeasure}
                onDragStart={() => {}}
                cardRef={cardRef}
                bodyRef={bodyRef}
              />
            </div>
          )}
        </div>
      </div>

      {popover && (
        <DigPopover
          target={popover}
          onSubmit={onDig}
          style={{ position: "fixed", left: popover.screenX, top: popover.screenY }}
        />
      )}

      {/* Toolbar */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur">
        <ToolbarBtn title="Zoom out" onClick={() => zoomAt((viewportRef.current?.clientWidth ?? 0) / 2, (viewportRef.current?.clientHeight ?? 0) / 2, 0.87)}>
          <Minus className="h-4 w-4" />
        </ToolbarBtn>
        <button
          onClick={() => setCamera({ scale: 1 })}
          className="min-w-[3ch] px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground"
          title="Reset zoom"
        >
          {Math.round(getCamera().scale * 100)}%
        </button>
        <ToolbarBtn title="Zoom in" onClick={() => zoomAt((viewportRef.current?.clientWidth ?? 0) / 2, (viewportRef.current?.clientHeight ?? 0) / 2, 1.15)}>
          <Plus className="h-4 w-4" />
        </ToolbarBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarBtn title="Frame all" onClick={frameAll}>
          <Maximize2 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Tidy layout" onClick={() => { setDragOverrides(new Map()); savePositions(itemId, new Map()); requestAnimationFrame(frameAll); }}>
          <Frame className="h-4 w-4" />
        </ToolbarBtn>
      </div>

      {nodes.length === 0 && !draft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-2 rounded-lg border border-border bg-background/80 p-6 text-center text-sm text-muted-foreground backdrop-blur">
            <Rabbit className="h-8 w-8 opacity-40" />
            <p className="font-medium text-foreground">Nothing dug yet</p>
            <p>Select any text in the document card, then ask a question or tap a lens.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

// --- helpers ---------------------------------------------------------------

/** First client rect of `needle` within `container`'s text, or null. */
function findTextRect(container: HTMLElement, needle: string): DOMRect | null {
  const norm = needle.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!norm) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = "";
  const chunks: { node: Text; start: number }[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    chunks.push({ node: n, start: acc.length });
    acc += n.data.replace(/\s+/g, " ");
  }
  const idx = acc.indexOf(norm.slice(0, 20));
  if (idx < 0) return null;
  // Find the chunk holding idx and build a range.
  const chunk = [...chunks].reverse().find((c) => c.start <= idx);
  if (!chunk) return null;
  const range = document.createRange();
  const offset = Math.max(0, idx - chunk.start);
  try {
    range.setStart(chunk.node, Math.min(offset, chunk.node.length));
    range.setEnd(chunk.node, Math.min(offset + 1, chunk.node.length));
    return range.getBoundingClientRect();
  } catch {
    return null;
  }
}

function loadPositions(itemId: string): Map<string, Pos> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(`rh.canvas.pos.${itemId}`);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, Pos>));
  } catch {
    return new Map();
  }
}
function savePositions(itemId: string, positions: Map<string, Pos>) {
  try {
    window.localStorage.setItem(`rh.canvas.pos.${itemId}`, JSON.stringify(Object.fromEntries(positions)));
  } catch {}
}
function loadView(itemId: string): { x: number; y: number; scale: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`rh.canvas.view.${itemId}`);
    return raw ? (JSON.parse(raw) as { x: number; y: number; scale: number }) : null;
  } catch {
    return null;
  }
}
function saveView(itemId: string, cam: { x: number; y: number; scale: number }) {
  try {
    window.localStorage.setItem(`rh.canvas.view.${itemId}`, JSON.stringify(cam));
  } catch {}
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (Fix any icon-name mismatches against `lucide-react`; `Frame`, `Maximize2`, `Minus`, `Plus`, `PanelRight`, `GripHorizontal`, `ChevronDown`, `ChevronRight` all exist.)

- [ ] **Step 5: Commit**

```bash
git add src/components/rabbithole/canvas/branch-card.tsx src/components/rabbithole/canvas/edges.tsx src/components/rabbithole/canvas/rabbithole-canvas.tsx
git commit -m "feat(rabbithole): infinite canvas view (cards, edges, dig-on-canvas)"
```

---

## Task 6: Wire the view toggle into the tab shell

Add `[Canvas | Split]` to the Rabbithole tab. Canvas default on `lg+`, split default below. Persist choice. "Open in split" from a card switches to split.

**Files:**
- Modify: `src/components/rabbithole/rabbithole-shell.tsx`

- [ ] **Step 1: Add the toggle + canvas branch to `rabbithole-shell.tsx`**

Add imports at the top (after the existing imports):

```tsx
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Rows } from "lucide-react";
import { RabbitholeCanvas } from "@/components/rabbithole/canvas/rabbithole-canvas";
```

Replace the current `useRef` line:

```tsx
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
```

with view-mode state (default resolved on mount to avoid SSR/window mismatch):

```tsx
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"canvas" | "split">("split");

  // Resolve the default once on the client: canvas on desktop, split on mobile,
  // unless the user has a saved preference.
  useEffect(() => {
    const saved = window.localStorage.getItem("rh.tab.mode");
    if (saved === "canvas" || saved === "split") {
      setMode(saved);
      return;
    }
    setMode(window.matchMedia("(min-width: 1024px)").matches ? "canvas" : "split");
  }, []);

  const chooseMode = (m: "canvas" | "split") => {
    setMode(m);
    try { window.localStorage.setItem("rh.tab.mode", m); } catch {}
  };
```

Inside the `root ? (...)` block, replace the whole split layout with a header
holding the toggle plus a conditional body. Replace this existing block:

```tsx
      {root ? (
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
          {/* Root document */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
```

...through its matching close, with:

```tsx
      {root ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* View toggle */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="truncate text-sm font-semibold">{root.title}</span>
            <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => chooseMode("canvas")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                  mode === "canvas" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title="Canvas view"
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Canvas
              </button>
              <button
                onClick={() => chooseMode("split")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                  mode === "split" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title="Split view"
              >
                <Rows className="h-3.5 w-3.5" /> Split
              </button>
            </div>
            <button
              onClick={() => router.push(`/directory?item=${root.itemId}`)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Open in Directory"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Directory
            </button>
          </div>

          {mode === "canvas" ? (
            <RabbitholeCanvas
              itemId={root.itemId}
              rootTitle={root.title}
              rootText={root.text}
              onOpenInSplit={() => chooseMode("split")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Root document */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                      <p className="italic text-muted-foreground">No readable text in this item yet.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Branch panel */}
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
          )}
        </div>
      ) : (
```

The `Rabbithole` import stays. Note the `— select text to dig` hint moved out; the toggle row replaces the old document header.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/rabbithole/rabbithole-shell.tsx
git commit -m "feat(rabbithole): Canvas/Split view toggle in the tab"
```

---

## Task 7: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the app**

Run: `npm run dev`, open `/rabbithole`, pick a Directory item with an existing hole (or dig a fresh one).

- [ ] **Step 2: Canvas checklist**

Verify each:
- Canvas is default on a desktop-width window; the root document renders as a card.
- Wheel scrolls the canvas (pan); a wheel gesture started inside a card scrolls the card.
- Ctrl/⌘+wheel zooms toward the cursor; toolbar +/−/reset and Frame-all work.
- Select text in the root card → popover; tap a lens → a child card streams in, edge draws from near the selected text.
- Select text in a branch card → dig again; deeper card + edge appear.
- Drag a card header repositions it; Tidy resets positions and frames all.
- Collapse hides a subtree and its edges; expand restores them.
- "Open in split" on a card switches to split view; toggle back to canvas restores camera.
- Delete a branch removes it and its subtree from the canvas.
- Reload the page → camera and card positions persist for that item.

- [ ] **Step 3: Split-view regression**

Toggle to Split. Confirm the original split experience (root doc left, branch panel right, breadcrumbs, dig, delete) is unchanged.

- [ ] **Step 4: Full test + build**

Run: `npm run test && npm run build`
Expected: all tests pass; production build succeeds.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(rabbithole): canvas verification follow-ups"
```

---

## Notes for the executor

- **Task order:** do Task 1, then Task 3 (DigPopover) before Task 2's Step 2 (the reader refactor imports it). Then Task 4, 5, 6, 7.
- **No new dependencies.** Everything uses existing packages (`react-markdown`, `remark-gfm`, `lucide-react`, `sonner`, Tailwind).
- **API/DB untouched.** `/api/rabbithole` routes and migration 0019 already cover the data model.
- **The anchor-rect finder is best-effort.** If `findTextRect` misses (markdown reflowed the phrase, or it's scrolled out), edges fall back to the parent card's right-edge midpoint — acceptable, never throws.
- **After finishing, run `graphify update .`** to refresh the knowledge graph, per the project's CLAUDE.md.

### Deliberate deviations from the spec

- **Stream error handling:** the spec described an error *card* with Retry/Discard
  actions. This plan keeps the existing proven behavior — a `sonner` toast plus
  dropping the draft — because that is what `dig()` already does and it avoids a
  new error-state surface. Retry = select the text and dig again. If a dedicated
  error card is wanted later, it's an additive follow-up.
- **Anchor-resolution testing:** the spec suggested a unit test for
  `findTextRect`'s fallback chain. It resolves via `Range.getBoundingClientRect`,
  which jsdom stubs to zeros, so a unit test can't exercise the real geometry.
  It is verified manually in Task 7 (Step 2) instead; the fallback path (parent
  card right-edge midpoint) is what guarantees it never throws.

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
  const [zoomPct, setZoomPct] = useState(100);

  const { getCamera, setCamera, zoomAt, frameRect } = useCamera(
    viewportRef,
    worldRef,
    edgesSvgRef,
    (cam) => {
      saveView(itemId, cam);
      setZoomPct((prev) => {
        const next = Math.round(cam.scale * 100);
        return next === prev ? prev : next; // pan (no scale change) → no re-render
      });
    },
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
      const offX = (found.right - bodyRect.left) / cam.scale;
      const offY = (found.top + found.height / 2 - bodyRect.top) / cam.scale;
      const cardEl = cardEls.current.get(parentId);
      const cardRect = cardEl?.getBoundingClientRect();
      const headerH = cardRect ? (bodyRect.top - cardRect.top) / cam.scale : 34;
      return { x: pPos.x + Math.min(offX, pSize.w), y: pPos.y + headerH + offY };
    },
    [byId, draft, getCamera],
  );

  // Recompute edge geometry after layout/scroll/stream via rAF.
  const rafRef = useRef(0);
  const scheduleEdges = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const out: Edge[] = [];
      const addEdge = (childId: string, parentId: string | null) => {
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
        addEdge(n.id, n.parentId);
      }
      if (draft) addEdge("__draft__", draft.parentId);
      setEdges(out);
    });
  }, [nodes, draft, positions, sizes, hidden, collapsed, hoveredChild, anchorPoint]);

  useLayoutEffect(() => {
    scheduleEdges();
  }, [scheduleEdges, positions]);

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

  // Frame the whole tree on first measure / item change (unless a saved view exists).
  const framedFor = useRef<string>("");
  useEffect(() => {
    if (framedFor.current === itemId) return;
    if (!sizes.size) return;
    framedFor.current = itemId;
    const saved = loadView(itemId);
    if (saved) setCamera(saved);
    else frameAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, sizes.size]);

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
  const dragOverridesRef = useRef(dragOverrides);
  dragOverridesRef.current = dragOverrides;
  const cardDrag = useRef<{ id: string; x: number; y: number; cx: number; cy: number } | null>(null);
  const onCardDragStart = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const pos = positions.get(id);
    if (!pos) return;
    cardDrag.current = { id, x: pos.x, y: pos.y, cx: e.clientX, cy: e.clientY };
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

  // Text selection inside a card → popover.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
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
    vp.addEventListener("mouseup", onMouseUp);
    return () => vp.removeEventListener("mouseup", onMouseUp);
  }, [streaming]);

  const onDig = useCallback(
    async (target: DigTarget, lens: RabbitholeLens | null, q: string) => {
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      await dig(target.parentId, target.text, lens, q);
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
  }, [scheduleEdges, nodes, draft, collapsed]);

  const draftNode = draft
    ? { id: "__draft__", title: "Digging…", anchorText: draft.anchorText, question: draft.question, content: draft.content }
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
              content={rootText}
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
          {zoomPct}%
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

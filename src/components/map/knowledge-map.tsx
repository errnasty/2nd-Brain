"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronRight, Loader2, Network, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type MapNode = {
  id: string;
  kind: "tag" | "item" | "folder";
  label: string;
  itemKind?: "saved_article" | "uploaded_document" | "user_note";
};
type MapLink = { source: string; target: string; kind?: "tag" | "folder" | "link" };
type Detail = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  content: string | null;
  preview: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  breadcrumb?: { id: string; name: string }[];
  tags?: string[];
};
type GraphData = { nodes: MapNode[]; links: MapLink[]; truncated?: boolean; total?: number; shown?: number };

type Palette = {
  folder: string; tag: string; article: string; document: string; note: string;
  link: string; folderLink: string; tagLink: string; halo: string;
};
const COLORS: Palette = {
  folder: "#A86223", tag: "#C57A35", article: "#4A4640", document: "#1B1714", note: "#807A71",
  link: "rgba(168,98,35,0.85)", folderLink: "rgba(168,98,35,0.5)", tagLink: "rgba(120,114,103,0.4)",
  halo: "rgba(250,246,238,0.92)",
};
const COLORS_DARK: Palette = {
  folder: "#D9923F", tag: "#E0A45C", article: "#CFC8BC", document: "#FAF6EE", note: "#9A938A",
  link: "rgba(217,146,63,0.9)", folderLink: "rgba(217,146,63,0.55)", tagLink: "rgba(180,172,160,0.4)",
  halo: "rgba(20,18,16,0.92)",
};
function typeColor(kind: MapNode["kind"], itemKind: MapNode["itemKind"], c: Palette): string {
  if (kind === "folder") return c.folder;
  if (kind === "tag") return c.tag;
  if (itemKind === "saved_article") return c.article;
  if (itemKind === "uploaded_document") return c.document;
  return c.note;
}
function radiusFor(kind: MapNode["kind"], degree: number): number {
  const base = kind === "folder" ? 10 : kind === "tag" ? 3.5 : 5;
  return base + Math.sqrt(degree) * (kind === "tag" ? 0.7 : 1.4);
}
function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

type SimNode = MapNode & { x: number; y: number; vx: number; vy: number; r: number; fixed?: boolean };
type SimLink = { source: SimNode; target: SimNode; kind?: MapLink["kind"] };
type Camera = { x: number; y: number; scale: number };
type ColorMode = "type" | "folder";

const DAMPING = 0.85;
const ALPHA_DECAY = 0.985;
const MIN_ALPHA = 0.02;
const SPRING = 0.025;

export function KnowledgeMap() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const palette = dark ? COLORS_DARK : COLORS;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Controls.
  const [showPanel, setShowPanel] = useState(false);
  const [depth, setDepth] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("type");
  const [arrows, setArrows] = useState(false);
  const [labelScale, setLabelScale] = useState(0.45);
  const [hideTags, setHideTags] = useState(false);
  const [hideDocs, setHideDocs] = useState(false);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [repel, setRepel] = useState(11000);
  const [linkDist, setLinkDist] = useState(120);
  const [centerForce, setCenterForce] = useState(0.018);

  // Engine refs (read live by the render/physics loop — no restart on change).
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const camRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const alphaRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const fittedRef = useRef(false);
  const draggingRef = useRef<SimNode | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const adjRef = useRef<Map<string, Set<string>>>(new Map());
  const paletteRef = useRef(palette);
  const darkRef = useRef(dark);
  const selectedIdRef = useRef<string | null>(null);
  const visibleIdsRef = useRef<Set<string> | null>(null);
  const repelRef = useRef(repel);
  const linkDistRef = useRef(linkDist);
  const gravityRef = useRef(centerForce);
  const labelScaleRef = useRef(labelScale);
  const arrowsRef = useRef(arrows);
  const colorModeRef = useRef<ColorMode>(colorMode);

  useEffect(() => { paletteRef.current = palette; darkRef.current = dark; }, [palette, dark]);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected]);
  useEffect(() => { repelRef.current = repel; alphaRef.current = Math.max(alphaRef.current, 0.4); }, [repel]);
  useEffect(() => { linkDistRef.current = linkDist; alphaRef.current = Math.max(alphaRef.current, 0.4); }, [linkDist]);
  useEffect(() => { gravityRef.current = centerForce; alphaRef.current = Math.max(alphaRef.current, 0.4); }, [centerForce]);
  useEffect(() => { labelScaleRef.current = labelScale; }, [labelScale]);
  useEffect(() => { arrowsRef.current = arrows; }, [arrows]);
  useEffect(() => { colorModeRef.current = colorMode; }, [colorMode]);

  const degreeMap = useMemo(() => {
    const d: Record<string, number> = {};
    if (data) for (const l of data.links) { d[l.source] = (d[l.source] ?? 0) + 1; d[l.target] = (d[l.target] ?? 0) + 1; }
    return d;
  }, [data]);

  // ── Filters + search → visible id set (null = all) ──────────────────
  const visibleIds = useMemo(() => {
    if (!data) return null as Set<string> | null;
    const q = query.trim().toLowerCase();
    if (!q && !hideTags && !hideDocs && !hideOrphans) return null;
    const passes = (n: MapNode) =>
      !(hideTags && n.kind === "tag") &&
      !(hideDocs && n.itemKind === "uploaded_document") &&
      !(hideOrphans && (degreeMap[n.id] ?? 0) === 0);
    let allowed = new Set(data.nodes.filter(passes).map((n) => n.id));
    if (q) {
      const matches = new Set(
        data.nodes.filter((n) => allowed.has(n.id) && n.label.toLowerCase().includes(q)).map((n) => n.id),
      );
      const expand = new Set(matches);
      for (const l of data.links) {
        if (matches.has(l.source) && allowed.has(l.target)) expand.add(l.target);
        if (matches.has(l.target) && allowed.has(l.source)) expand.add(l.source);
      }
      allowed = expand;
    }
    return allowed;
  }, [data, query, hideTags, hideDocs, hideOrphans, degreeMap]);
  useEffect(() => { visibleIdsRef.current = visibleIds; }, [visibleIds]);

  const summary = useMemo(() => {
    if (!data) return null;
    let folders = 0, tags = 0, items = 0;
    for (const n of data.nodes) {
      if (n.kind === "folder") folders++;
      else if (n.kind === "tag") tags++;
      else items++;
    }
    return { folders, tags, items, edges: data.links.length };
  }, [data]);

  // ── Load graph (depth applies when focused) ─────────────────────────
  const loadGraph = useCallback((center: string | null, d: number) => {
    const CACHE_KEY = "knowledgeMap.cache.v2";
    const CACHE_TTL_MS = 60_000;
    setError(null);
    if (!center) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number; data: GraphData };
          if (Date.now() - parsed.at < CACHE_TTL_MS && parsed.data) {
            setData(parsed.data);
            setLoading(false);
          }
        }
      } catch {
        // ignore
      }
    } else {
      setLoading(true);
    }
    const url = center ? `/api/map?center=${center}&depth=${d}` : "/api/map";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GraphData>;
      })
      .then((dd) => {
        setData(dd);
        if (!center) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: dd })); } catch { /* quota */ }
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Reload on focus change; on a depth change, only reload when actually focused
  // (depth is meaningless for the global graph, so don't rebuild/reset it).
  const prevDepthRef = useRef(depth);
  useEffect(() => {
    const depthChanged = prevDepthRef.current !== depth;
    prevDepthRef.current = depth;
    if (depthChanged && !centerId) return;
    loadGraph(centerId, depth);
  }, [centerId, depth, loadGraph]);

  const selectNode = useCallback((node: MapNode) => {
    setSelected(node);
    if (node.kind !== "item") { setDetail(null); return; }
    const rawId = node.id.startsWith("i:") ? node.id.slice(2) : node.id;
    setDetailLoading(true);
    fetch(`/api/directory/${rawId}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Detail) : null))
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  // ── Build sim + render loop ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data || data.nodes.length === 0) return;

    const degree: Record<string, number> = {};
    for (const l of data.links) { degree[l.source] = (degree[l.source] ?? 0) + 1; degree[l.target] = (degree[l.target] ?? 0) + 1; }

    const n = data.nodes.length;
    const nodes: SimNode[] = data.nodes.map((nd, i) => {
      const a = i * 2.399963;
      const rad = Math.sqrt(i + 1) * 26;
      return { ...nd, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, r: radiusFor(nd.kind, degree[nd.id] ?? 0) };
    });
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));
    const links: SimLink[] = [];
    const adj = new Map<string, Set<string>>();
    const linkAdj = (a: string, b: string) => {
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
    };
    // item → folder hue, for color-by-folder mode.
    const itemFolder = new Map<string, string>();
    for (const l of data.links) {
      const s = byId.get(l.source); const t = byId.get(l.target);
      if (s && t) { links.push({ source: s, target: t, kind: l.kind }); linkAdj(l.source, l.target); }
      if (l.kind === "folder" && l.source.startsWith("f:") && l.target.startsWith("i:")) itemFolder.set(l.target, l.source);
    }
    nodesRef.current = nodes;
    linksRef.current = links;
    adjRef.current = adj;
    alphaRef.current = 1;
    fittedRef.current = false;

    function colorFor(nd: SimNode, pal: Palette): string {
      if (colorModeRef.current === "folder") {
        const fid = nd.kind === "folder" ? nd.id : itemFolder.get(nd.id);
        if (fid) return `hsl(${hueOf(fid)} 52% ${darkRef.current ? 62 : 42}%)`;
        if (nd.kind === "tag") return pal.tag;
        return pal.note;
      }
      return typeColor(nd.kind, nd.itemKind, pal);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cssW = 0, cssH = 0, dpr = 1;
    function resize() {
      const rect = container!.getBoundingClientRect();
      cssW = rect.width; cssH = rect.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.max(1, Math.round(cssW * dpr));
      canvas!.height = Math.max(1, Math.round(cssH * dpr));
      canvas!.style.width = `${cssW}px`; canvas!.style.height = `${cssH}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    function fitToView() {
      if (nodes.length === 0 || cssW === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const nd of nodes) { minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x); minY = Math.min(minY, nd.y); maxY = Math.max(maxY, nd.y); }
      const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
      camRef.current.scale = Math.max(0.1, Math.min(cssW / (spanX + 140), cssH / (spanY + 140), 2));
      camRef.current.x = -((minX + maxX) / 2) * camRef.current.scale;
      camRef.current.y = -((minY + maxY) / 2) * camRef.current.scale;
    }

    function step() {
      const a = alphaRef.current;
      const REP = repelRef.current, LD = linkDistRef.current, G = gravityRef.current;
      for (let i = 0; i < n; i++) {
        const ni = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const nj = nodes[j];
          let dx = ni.x - nj.x, dy = ni.y - nj.y, d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
          const dist = Math.sqrt(d2), f = (REP / d2) * a;
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          ni.vx += fx; ni.vy += fy; nj.vx -= fx; nj.vy -= fy;
        }
      }
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (dist - LD) * SPRING * a;
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        l.source.vx += fx; l.source.vy += fy; l.target.vx -= fx; l.target.vy -= fy;
      }
      for (const nd of nodes) {
        nd.vx += -nd.x * G * a; nd.vy += -nd.y * G * a;
        nd.vx *= DAMPING; nd.vy *= DAMPING;
        if (draggingRef.current === nd || nd.fixed) continue;
        nd.x += nd.vx; nd.y += nd.vy;
      }
      alphaRef.current = a * ALPHA_DECAY;
    }

    function render() {
      const pal = paletteRef.current, cam = camRef.current, vis = visibleIdsRef.current;
      const selId = selectedIdRef.current, hovered = hoveredRef.current;
      // Hover highlight set = hovered + neighbors.
      let hi: Set<string> | null = null;
      if (hovered) { hi = new Set([hovered]); for (const nb of adjRef.current.get(hovered) ?? []) hi.add(nb); }
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.translate(cssW / 2 + cam.x, cssH / 2 + cam.y);
      ctx!.scale(cam.scale, cam.scale);

      ctx!.lineCap = "round";
      for (const l of links) {
        if (vis && !(vis.has(l.source.id) && vis.has(l.target.id))) continue;
        const lit = !hi || (hi.has(l.source.id) && hi.has(l.target.id));
        ctx!.globalAlpha = lit ? 1 : 0.08;
        ctx!.strokeStyle = l.kind === "link" ? pal.link : l.kind === "folder" ? pal.folderLink : pal.tagLink;
        ctx!.lineWidth = (l.kind === "link" ? 2 : l.kind === "folder" ? 1.4 : 0.9) / cam.scale;
        ctx!.beginPath();
        ctx!.moveTo(l.source.x, l.source.y);
        ctx!.lineTo(l.target.x, l.target.y);
        ctx!.stroke();
        if (arrowsRef.current && l.kind === "link" && lit) {
          const ang = Math.atan2(l.target.y - l.source.y, l.target.x - l.source.x);
          const tx = l.target.x - Math.cos(ang) * l.target.r;
          const ty = l.target.y - Math.sin(ang) * l.target.r;
          const ah = 6 / cam.scale;
          ctx!.beginPath();
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(tx - Math.cos(ang - 0.4) * ah, ty - Math.sin(ang - 0.4) * ah);
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(tx - Math.cos(ang + 0.4) * ah, ty - Math.sin(ang + 0.4) * ah);
          ctx!.stroke();
        }
      }

      const labelThreshold = labelScaleRef.current;
      for (const nd of nodes) {
        if (vis && !vis.has(nd.id)) continue;
        const lit = !hi || hi.has(nd.id);
        ctx!.globalAlpha = lit ? 1 : 0.12;
        const color = colorFor(nd, pal);
        ctx!.beginPath();
        ctx!.arc(nd.x, nd.y, nd.r, 0, 2 * Math.PI);
        ctx!.fillStyle = color;
        ctx!.fill();
        if (nd.fixed) {
          ctx!.lineWidth = 1.5 / cam.scale;
          ctx!.strokeStyle = pal.halo;
          ctx!.stroke();
        }
        if (nd.id === selId) {
          ctx!.lineWidth = 2 / cam.scale;
          ctx!.strokeStyle = "hsl(var(--brand))";
          ctx!.beginPath();
          ctx!.arc(nd.x, nd.y, nd.r + 3 / cam.scale, 0, 2 * Math.PI);
          ctx!.stroke();
        }
        const showLabel = nd.kind !== "item" || cam.scale > labelThreshold || (hi && hi.has(nd.id));
        if (showLabel) {
          const label = nd.label.length > 28 ? nd.label.slice(0, 28) + "…" : nd.label;
          const fs = (nd.kind === "folder" ? 13 : nd.kind === "tag" ? 9 : 11) / cam.scale;
          ctx!.font = `${nd.kind === "folder" ? "600 " : "500 "}${fs}px Georgia, serif`;
          ctx!.textAlign = "center";
          ctx!.textBaseline = "top";
          const ly = nd.y + nd.r + 3 / cam.scale;
          ctx!.lineWidth = 3 / cam.scale;
          ctx!.strokeStyle = pal.halo;
          ctx!.lineJoin = "round";
          ctx!.strokeText(label, nd.x, ly);
          ctx!.fillStyle = color;
          ctx!.fillText(label, nd.x, ly);
        }
      }
      ctx!.globalAlpha = 1;
    }

    function frame() {
      if (alphaRef.current > MIN_ALPHA || draggingRef.current) step();
      else if (!fittedRef.current) { fitToView(); fittedRef.current = true; }
      render();
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [data]);

  // ── Interaction ─────────────────────────────────────────────────────
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cam = camRef.current;
    return {
      x: (sx - rect.left - (rect.width / 2 + cam.x)) / cam.scale,
      y: (sy - rect.top - (rect.height / 2 + cam.y)) / cam.scale,
    };
  }, []);
  const hitTest = useCallback((sx: number, sy: number): SimNode | null => {
    const w = screenToWorld(sx, sy);
    const vis = visibleIdsRef.current;
    let best: SimNode | null = null, bestD = Infinity;
    for (const nd of nodesRef.current) {
      if (vis && !vis.has(nd.id)) continue;
      const dx = nd.x - w.x, dy = nd.y - w.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= nd.r + 6 && d < bestD) { best = nd; bestD = d; }
    }
    return best;
  }, [screenToWorld]);

  const pointer = useRef<{ downX: number; downY: number; lastX: number; lastY: number; moved: boolean; node: SimNode | null } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const node = hitTest(e.clientX, e.clientY);
    pointer.current = { downX: e.clientX, downY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, node };
    if (node) draggingRef.current = node;
  }, [hitTest]);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current, canvas = canvasRef.current;
    if (!canvas) return;
    if (!p) {
      const hit = hitTest(e.clientX, e.clientY);
      hoveredRef.current = hit?.id ?? null;
      canvas.style.cursor = hit ? "pointer" : "grab";
      return;
    }
    const dx = e.clientX - p.lastX, dy = e.clientY - p.lastY;
    if (Math.abs(e.clientX - p.downX) > 4 || Math.abs(e.clientY - p.downY) > 4) p.moved = true;
    p.lastX = e.clientX; p.lastY = e.clientY;
    if (p.node) {
      const w = screenToWorld(e.clientX, e.clientY);
      p.node.x = w.x; p.node.y = w.y; p.node.vx = 0; p.node.vy = 0;
      alphaRef.current = Math.max(alphaRef.current, 0.3);
    } else {
      camRef.current.x += dx; camRef.current.y += dy;
    }
  }, [hitTest, screenToWorld]);
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    pointer.current = null; draggingRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    if (!p) return;
    if (!p.moved && p.node) selectNode(p.node);
  }, [selectNode]);
  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = hitTest(e.clientX, e.clientY);
    if (node) { node.fixed = !node.fixed; node.vx = 0; node.vy = 0; alphaRef.current = Math.max(alphaRef.current, 0.3); }
  }, [hitTest]);
  // Clear hover highlight when the cursor leaves the canvas (otherwise the last
  // hovered node + neighbors stay lit and everything else stays dimmed).
  const onPointerLeave = useCallback(() => {
    if (!pointer.current) {
      hoveredRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const cam = camRef.current, rect = canvas!.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2, py = e.clientY - rect.top - rect.height / 2;
      const next = Math.min(4, Math.max(0.1, cam.scale * Math.exp(-e.deltaY * 0.0012)));
      cam.x = px - ((px - cam.x) * next) / cam.scale;
      cam.y = py - ((py - cam.y) * next) / cam.scale;
      cam.scale = next;
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [data]);

  const hasGraph = !loading && !error && data && data.nodes.length > 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 pb-3 pt-4">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 editorial-eyebrow">
          <span className="inline-flex items-center gap-1.5">
            <Network className="h-3 w-3" /> Topology · the shape of your library
          </span>
          {summary && (
            <span style={{ color: "hsl(var(--brand))" }}>
              {summary.items} items · {summary.tags} tags · {summary.folders} folders · {summary.edges} edges
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>
            {centerId ? "Local graph" : "Knowledge map"}
          </h1>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter nodes…"
                className="h-8 w-44 rounded-md border border-border bg-background pl-8 pr-7 text-[13px] outline-none focus:border-primary"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" title="Clear">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {centerId && (
              <button onClick={() => setCenterId(null)} className="font-mono text-xs uppercase tracking-[0.12em] hover:underline" style={{ color: "hsl(var(--brand))" }}>
                ← Exit local graph
              </button>
            )}
            <button
              onClick={() => setShowPanel((v) => !v)}
              title="Graph settings"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent ${showPanel ? "text-brand" : "text-muted-foreground"}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="relative flex-1 overflow-hidden bg-background">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm italic text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building knowledge map…
            </div>
          )}
          {error && <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>}
          {!loading && !error && data && data.nodes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Network className="h-10 w-10 text-muted-foreground/30" />
              <p className="editorial-display text-base">Nothing to map yet</p>
              <p className="max-w-md text-xs italic text-muted-foreground">
                Save articles to your Directory, upload docs, or write notes — and the knowledge map fills in as items get tagged.
              </p>
            </div>
          )}
          {hasGraph && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 touch-none"
              style={{ cursor: "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerLeave}
              onDoubleClick={onDoubleClick}
            />
          )}

          {/* Settings panel */}
          {hasGraph && showPanel && (
            <div className="absolute right-4 top-4 w-60 rounded-xl border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="editorial-eyebrow-brand">§ Graph settings</span>
                <button onClick={() => setShowPanel(false)} className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
              <Field label="Color by">
                <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)} className="h-7 w-full rounded border border-border bg-background px-1.5 text-xs outline-none">
                  <option value="type">Type</option>
                  <option value="folder">Folder</option>
                </select>
              </Field>
              <Field label={`Local depth · ${depth}`}>
                <input type="range" min={1} max={4} step={1} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="w-full accent-[hsl(var(--brand))]" />
                {!centerId && <span className="text-[10px] italic text-muted-foreground">applies after “Focus local graph”</span>}
              </Field>
              <div className="my-2 border-t border-border" />
              <Toggle label="Hide tags" checked={hideTags} onChange={setHideTags} />
              <Toggle label="Hide attachments" checked={hideDocs} onChange={setHideDocs} />
              <Toggle label="Hide orphans" checked={hideOrphans} onChange={setHideOrphans} />
              <Toggle label="Link arrows" checked={arrows} onChange={setArrows} />
              <div className="my-2 border-t border-border" />
              <Field label="Label fade"><Range min={0.1} max={1.2} step={0.05} value={labelScale} onChange={setLabelScale} /></Field>
              <Field label="Repel force"><Range min={2000} max={30000} step={500} value={repel} onChange={setRepel} /></Field>
              <Field label="Link distance"><Range min={40} max={260} step={5} value={linkDist} onChange={setLinkDist} /></Field>
              <Field label="Center force"><Range min={0} max={0.08} step={0.002} value={centerForce} onChange={setCenterForce} /></Field>
            </div>
          )}

          {/* Legend */}
          {hasGraph && (
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-border bg-card/95 px-3 py-2.5 backdrop-blur">
              <div className="mb-1.5 editorial-eyebrow-brand">§ Legend</div>
              <div className="space-y-0.5 text-[11px]">
                <LegendDot color={palette.folder} label="Folder" />
                <LegendDot color={palette.tag} label="Tag" />
                <LegendDot color={palette.article} label="Saved article" />
                <LegendDot color={palette.document} label="Uploaded document" />
                <LegendDot color={palette.note} label="User note" />
              </div>
              <div className="mt-2 border-t border-border pt-1.5 font-mono text-[10px] italic text-muted-foreground">
                {data!.truncated ? `Top ${data!.shown} of ${data!.total} · ` : ""}drag · scroll zoom · dbl-click pin
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-xl lg:static lg:inset-auto lg:z-auto lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="editorial-eyebrow-brand">
                § {selected.kind === "tag" ? "Tag" : selected.kind === "folder" ? "Folder" : "Item"}
              </div>
              <button onClick={() => { setSelected(null); setDetail(null); }} className="rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                <h2 className="editorial-display" style={{ fontSize: "1.25rem", letterSpacing: "-0.014em" }}>{selected.label}</h2>
                {selected.kind === "tag" && <p className="mt-3 text-sm italic text-muted-foreground">Click an item connected to this tag to open it.</p>}
                {selected.kind === "folder" && <p className="mt-3 text-sm italic text-muted-foreground">Folder. Click a connected item to inspect it, or open it in the Directory.</p>}
                {selected.kind === "item" && detailLoading && (
                  <div className="mt-4 flex items-center gap-2 text-sm italic text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
                )}
                {selected.kind === "item" && detail && (
                  <>
                    <nav className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {(detail.breadcrumb && detail.breadcrumb.length > 0 ? detail.breadcrumb.map((b) => b.name) : ["Unsorted"]).map((name, i, arr) => (
                        <span key={name + i} className="flex items-center gap-1">{name}{i < arr.length - 1 && <ChevronRight className="h-3 w-3 opacity-50" />}</span>
                      ))}
                    </nav>
                    <p className="mt-1 text-xs italic capitalize text-muted-foreground">{detail.kind.replace("_", " ")}</p>
                    {detail.tags && detail.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {detail.tags.map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">#{t}</span>)}
                      </div>
                    )}
                    {detail.preview ? (
                      <p className="mt-4 text-[14px] leading-relaxed text-foreground/85">{detail.preview}</p>
                    ) : (
                      <p className="mt-4 text-sm italic text-muted-foreground">(no preview available)</p>
                    )}
                    <div className="mt-4 flex flex-col gap-2">
                      {detail.sourceUrl && (
                        <Button asChild size="sm" variant="outline"><a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">Open original</a></Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setCenterId(detail.id)}><Network className="mr-1.5 h-3.5 w-3.5" /> Focus local graph</Button>
                      <Button size="sm" variant="brand" onClick={() => router.push(`/directory?item=${detail.id}`)}>Open in Directory</Button>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Range({ min, max, step, value, onChange }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--brand))]" />;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-1.5 flex cursor-pointer items-center justify-between">
      <span className="text-xs">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[hsl(var(--brand))]" />
    </label>
  );
}
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

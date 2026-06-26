"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Network, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type MapNode = {
  id: string;
  kind: "tag" | "item" | "folder";
  label: string;
  itemKind?: "saved_article" | "uploaded_document" | "user_note";
  x?: number;
  y?: number;
};

type MapLink = {
  source: string | MapNode;
  target: string | MapNode;
  kind?: "tag" | "folder" | "link";
};

type Detail = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  content: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  breadcrumb?: { id: string; name: string }[];
  tags?: string[];
};

// Warm brass-and-parchment graph palette so the map sits in the same world as
// the rest of the app instead of looking like a different product.
const COLORS = {
  folder: "#A86223", // brass
  tag: "#C57A35",    // lighter brass
  article: "#4A4640", // ink
  document: "#1B1714", // deep ink
  note: "#807A71",     // slate-gray
  link: "rgba(168,98,35,0.85)",
  folderLink: "rgba(168,98,35,0.55)",
  tagLink: "rgba(120,114,103,0.45)",
};

function nodeColorFor(node: MapNode): string {
  if (node.kind === "folder") return COLORS.folder;
  if (node.kind === "tag") return COLORS.tag;
  switch (node.itemKind) {
    case "saved_article":
      return COLORS.article;
    case "uploaded_document":
      return COLORS.document;
    default:
      return COLORS.note;
  }
}
function nodeRadiusFor(node: MapNode, degree = 0): number {
  const base = node.kind === "folder" ? 8 : node.kind === "tag" ? 5 : 3;
  return base + Math.sqrt(degree) * 1.2;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphHandle = any;

export function KnowledgeMap() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphHandle>(null);
  const [data, setData] = useState<{
    nodes: MapNode[];
    links: MapLink[];
    truncated?: boolean;
    total?: number;
    shown?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [centerId, setCenterId] = useState<string | null>(null);

  const loadGraph = useCallback((center: string | null) => {
    const CACHE_KEY = "knowledgeMap.cache.v1";
    const CACHE_TTL_MS = 60_000;
    setError(null);
    if (!center) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number; data: typeof data };
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

    const url = center ? `/api/map?center=${center}` : "/api/map";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        setData(d);
        if (!center) {
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: d }));
          } catch {
            // quota — ignore
          }
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadGraph(centerId);
  }, [centerId, loadGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onNodeClick = useCallback(
    async (node: MapNode) => {
      setSelected(node);
      const n = node as MapNode & { x?: number; y?: number };
      if (fgRef.current && typeof n.x === "number" && typeof n.y === "number") {
        fgRef.current.centerAt(n.x, n.y, 600);
        fgRef.current.zoom(2.4, 600);
      }
      if (node.kind !== "item") {
        setDetail(null);
        return;
      }
      const rawId = node.id.startsWith("i:") ? node.id.slice(2) : node.id;
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/directory/${rawId}`, { cache: "no-store" });
        if (res.ok) setDetail(await res.json());
        else setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  const degreeMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!data) return map;
    for (const link of data.links) {
      const src = typeof link.source === "string" ? link.source : (link.source as MapNode).id;
      const tgt = typeof link.target === "string" ? link.target : (link.target as MapNode).id;
      map[src] = (map[src] ?? 0) + 1;
      map[tgt] = (map[tgt] ?? 0) + 1;
    }
    return map;
  }, [data]);

  const itemNodeColor = useCallback((n: object) => nodeColorFor(n as MapNode), []);
  const itemNodeSize = useCallback(
    (n: object) => nodeRadiusFor(n as MapNode, degreeMap[(n as MapNode).id] ?? 0),
    [degreeMap],
  );
  const nodeLabel = useCallback((n: object) => (n as MapNode).label, []);

  const graphData = useMemo(() => data ?? { nodes: [], links: [] }, [data]);

  // Summary counts for the editorial header
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Editorial header ──────────────────────────────────────── */}
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
        <div className="flex items-baseline justify-between gap-3">
          <h1
            className="editorial-display m-0"
            style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}
          >
            {centerId ? "Local graph" : "Knowledge map"}
          </h1>
          {centerId && (
            <button
              onClick={() => setCenterId(null)}
              className="font-mono text-xs uppercase tracking-[0.12em] hover:underline"
              style={{ color: "hsl(var(--brand))" }}
            >
              ← Exit local graph
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="relative flex-1 bg-background">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm italic text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Building knowledge map…
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && !error && data && data.nodes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Network className="h-10 w-10 text-muted-foreground/30" />
              <p className="editorial-display text-base">Nothing to map yet</p>
              <p className="max-w-md text-xs italic text-muted-foreground">
                Save articles to your Directory, upload docs, or write notes — and the knowledge map
                will fill in as items get tagged.
              </p>
            </div>
          )}
          {!loading && !error && data && data.nodes.length > 0 && dims.width > 0 && (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              width={dims.width}
              height={dims.height}
              nodeColor={itemNodeColor}
              nodeVal={itemNodeSize}
              nodeLabel={nodeLabel}
              linkColor={(l: object) => {
                const k = (l as MapLink).kind;
                if (k === "link") return COLORS.link;
                if (k === "folder") return COLORS.folderLink;
                return COLORS.tagLink;
              }}
              linkWidth={(l: object) => {
                const k = (l as MapLink).kind;
                return k === "link" ? 2.2 : k === "folder" ? 1.6 : 1;
              }}
              linkDirectionalParticles={(l: object) => ((l as MapLink).kind === "link" ? 3 : 0)}
              linkDirectionalParticleWidth={2.4}
              backgroundColor="transparent"
              cooldownTime={1500}
              cooldownTicks={200}
              warmupTicks={60}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.25}
              onNodeClick={onNodeClick as (n: object) => void}
              nodeCanvasObjectMode="after"
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as MapNode;
                if (globalScale < 0.5) return;
                const degree = degreeMap[n.id] ?? 0;
                const radius = nodeRadiusFor(n, degree);
                const label = n.label.length > 30 ? n.label.slice(0, 30) + "…" : n.label;
                const fontSize = (n.kind === "folder" ? 13 : 11) / globalScale;
                ctx.font = `${n.kind === "folder" ? "600 " : "500 "}${fontSize}px Georgia, serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                const x = n.x ?? 0;
                const y = (n.y ?? 0) + radius + 3 / globalScale;
                // Parchment halo behind text for contrast.
                ctx.lineWidth = 3.5 / globalScale;
                ctx.strokeStyle = "rgba(250,246,238,0.92)";
                ctx.lineJoin = "round";
                ctx.strokeText(label, x, y);
                ctx.fillStyle = nodeColorFor(n);
                ctx.fillText(label, x, y);
              }}
            />
          )}

          {/* Editorial legend */}
          <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-card/95 px-3 py-2.5 backdrop-blur">
            <div className="mb-1.5 editorial-eyebrow-brand">§ Legend</div>
            <div className="space-y-0.5 text-[11px]">
              <LegendDot color={COLORS.folder} label="Folder" />
              <LegendDot color={COLORS.tag} label="Tag" />
              <LegendDot color={COLORS.article} label="Saved article" />
              <LegendDot color={COLORS.document} label="Uploaded document" />
              <LegendDot color={COLORS.note} label="User note" />
              <LegendDot color="hsl(var(--brand))" label="Wikilink (animated)" />
            </div>
            {data?.truncated && (
              <div className="mt-2 border-t border-border pt-1.5 font-mono text-[10px] italic text-muted-foreground">
                Showing top {data.shown} of {data.total} most-connected
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-xl lg:static lg:inset-auto lg:z-auto lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="editorial-eyebrow-brand">
                § {selected.kind === "tag" ? "Tag" : selected.kind === "folder" ? "Folder" : "Item"}
              </div>
              <button
                onClick={() => { setSelected(null); setDetail(null); }}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                <h2
                  className="editorial-display"
                  style={{ fontSize: "1.25rem", letterSpacing: "-0.014em" }}
                >
                  {selected.label}
                </h2>

                {selected.kind === "tag" && (
                  <p className="mt-3 text-sm italic text-muted-foreground">
                    Click an item connected to this tag to open it.
                  </p>
                )}

                {selected.kind === "folder" && (
                  <p className="mt-3 text-sm italic text-muted-foreground">
                    Folder. Click a connected item to inspect its contents, or open it in the Directory.
                  </p>
                )}

                {selected.kind === "item" && detailLoading && (
                  <div className="mt-4 flex items-center gap-2 text-sm italic text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                )}

                {selected.kind === "item" && detail && (
                  <>
                    <nav className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {(detail.breadcrumb && detail.breadcrumb.length > 0
                        ? detail.breadcrumb.map((b) => b.name)
                        : ["Unsorted"]
                      ).map((name, i, arr) => (
                        <span key={name + i} className="flex items-center gap-1">
                          {name}
                          {i < arr.length - 1 && <ChevronRight className="h-3 w-3 opacity-50" />}
                        </span>
                      ))}
                    </nav>

                    <p className="mt-1 text-xs italic capitalize text-muted-foreground">
                      {detail.kind.replace("_", " ")}
                    </p>

                    {detail.tags && detail.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {detail.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="prose-reader mt-4 max-w-none text-sm">
                      {detail.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {detail.content.slice(0, 4000)}
                        </ReactMarkdown>
                      ) : (
                        <p className="italic text-muted-foreground">(no preview available)</p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      {detail.sourceUrl && (
                        <Button asChild size="sm" variant="outline">
                          <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
                            Open original
                          </a>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCenterId(detail.id)}
                      >
                        <Network className="mr-1.5 h-3.5 w-3.5" />
                        Focus local graph
                      </Button>
                      <Button size="sm" variant="brand" onClick={() => router.push(`/directory?item=${detail.id}`)}>
                        Open in Directory
                      </Button>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

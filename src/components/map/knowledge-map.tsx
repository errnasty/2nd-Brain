"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Network, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

// Force graph is browser-only (uses window). SSR off; loaded lazily.
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

// Node radius + color by type. Folders largest + purple, tags medium + amber,
// items small + per-kind color.
const FOLDER_COLOR = "#8b5cf6"; // violet-500
function nodeColorFor(node: MapNode): string {
  if (node.kind === "folder") return FOLDER_COLOR;
  if (node.kind === "tag") return "#d97706";
  switch (node.itemKind) {
    case "saved_article":
      return "#3b82f6";
    case "uploaded_document":
      return "#10b981";
    default:
      return "#9ca3af";
  }
}
function nodeRadiusFor(node: MapNode): number {
  if (node.kind === "folder") return 10;
  if (node.kind === "tag") return 7;
  return 4;
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

  // Fetch graph (full or, when centerId set, a depth-1 local graph). Full graph
  // is cached in sessionStorage (60s); local graphs are small + always fresh.
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

  // Resize observer
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
      // Smoothly lock the camera onto the clicked node.
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

  const itemNodeColor = useCallback((n: object) => nodeColorFor(n as MapNode), []);
  const itemNodeSize = useCallback((n: object) => nodeRadiusFor(n as MapNode), []);
  const nodeLabel = useCallback((n: object) => (n as MapNode).label, []);

  // Memoize the graph data to prevent re-layout
  const graphData = useMemo(() => data ?? { nodes: [], links: [] }, [data]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div ref={containerRef} className="relative flex-1 bg-background">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <Network className="h-10 w-10 opacity-30" />
            <p>
              No graph to show yet. Save articles to your Directory, upload docs, or write notes —
              <br />
              and the knowledge map will fill in as items get tagged.
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
              if (k === "link") return "rgba(96,165,250,0.6)"; // wikilink — solid blue
              if (k === "folder") return "rgba(139,92,246,0.35)";
              return "rgba(120,120,120,0.22)";
            }}
            linkWidth={(l: object) => {
              const k = (l as MapLink).kind;
              return k === "link" ? 1.4 : k === "folder" ? 1 : 0.5;
            }}
            linkDirectionalParticles={(l: object) => ((l as MapLink).kind === "link" ? 2 : 0)}
            linkDirectionalParticleWidth={1.6}
            backgroundColor="transparent"
            cooldownTime={1500}
            cooldownTicks={200}
            warmupTicks={20}
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.35}
            onNodeClick={onNodeClick as (n: object) => void}
            nodeCanvasObjectMode={(node) => {
              // Only paint the custom label layer when the user is zoomed in enough.
              // At low zoom we let the library's default circle render — that means
              // labels skip painting entirely on the most-expensive frames.
              return "after";
            }}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as MapNode;
              // Folders always labelled; tags/items only when zoomed in enough.
              if (n.kind !== "folder" && globalScale < 1.4) return;
              const label = n.label.length > 36 ? n.label.slice(0, 36) + "…" : n.label;
              const fontSize = (n.kind === "folder" ? 13 : 11) / globalScale;
              ctx.font = `${n.kind === "folder" ? "600 " : ""}${fontSize}px Georgia, serif`;
              ctx.fillStyle = n.kind === "folder" ? "rgba(167,139,250,0.95)" : "rgba(160,160,160,0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + nodeRadiusFor(n) + 1);
            }}
          />
        )}

        {/* Local-graph banner */}
        {centerId && (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
            <Network className="h-3.5 w-3.5 text-primary" />
            <span>Local graph</span>
            <button onClick={() => setCenterId(null)} className="font-medium text-primary hover:underline">
              Exit
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-card/90 px-3 py-2 text-[11px] backdrop-blur">
          <div className="mb-1 font-medium text-muted-foreground">Legend</div>
          <div className="space-y-0.5">
            <LegendDot color="#8b5cf6" label="Folder" />
            <LegendDot color="#d97706" label="Tag" />
            <LegendDot color="#3b82f6" label="Saved article" />
            <LegendDot color="#10b981" label="Uploaded doc" />
            <LegendDot color="#9ca3af" label="User note" />
            <LegendDot color="#60a5fa" label="Wikilink" />
          </div>
          {data?.truncated && (
            <div className="mt-2 border-t border-border pt-1 text-[10px] text-muted-foreground">
              Showing top {data.shown} of {data.total} most-connected nodes
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      {selected && (
        <aside className="hidden w-96 shrink-0 flex-col border-l border-border lg:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {selected.kind === "tag" ? "Tag" : selected.kind === "folder" ? "Folder" : "Item"}
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
              <h2 className="text-lg font-semibold">{selected.label}</h2>

              {selected.kind === "tag" && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Click an item connected to this tag to open it.
                </p>
              )}

              {selected.kind === "folder" && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Folder. Click a connected item to inspect its contents, or open it in the
                  Directory.
                </p>
              )}

              {selected.kind === "item" && detailLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}

              {selected.kind === "item" && detail && (
                <>
                  {/* Folder breadcrumb */}
                  <nav className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
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

                  <p className="mt-1 text-xs text-muted-foreground capitalize">
                    {detail.kind.replace("_", " ")}
                  </p>

                  {/* Tags */}
                  {detail.tags && detail.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {detail.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Markdown preview */}
                  <div className="prose-reader mt-4 max-w-none text-sm">
                    {detail.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {detail.content.slice(0, 4000)}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-muted-foreground">(no preview available)</p>
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
                    <Button size="sm" onClick={() => router.push(`/directory?item=${detail.id}`)}>
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

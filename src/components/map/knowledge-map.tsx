"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

// Force graph is browser-only (uses window). SSR off; loaded lazily.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type MapNode = {
  id: string;
  kind: "tag" | "item";
  label: string;
  itemKind?: "saved_article" | "uploaded_document" | "user_note";
  x?: number;
  y?: number;
};

type MapLink = {
  source: string | MapNode;
  target: string | MapNode;
};

type Detail = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  content: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
};

export function KnowledgeMap() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Fetch graph with session-storage cache (60s TTL). Avoids the multi-MB
  // payload on every navigation to /map.
  useEffect(() => {
    const CACHE_KEY = "knowledgeMap.cache.v1";
    const CACHE_TTL_MS = 60_000;

    let aborted = false;
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
      // ignore cache errors
    }

    fetch("/api/map", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        if (aborted) return;
        setData(d);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: d }));
        } catch {
          // quota exceeded — silently ignore
        }
      })
      .catch((err) => {
        if (!aborted) setError(err.message ?? "Failed to load");
      })
      .finally(() => !aborted && setLoading(false));
    return () => {
      aborted = true;
    };
  }, []);

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

  const itemNodeColor = useCallback((n: object) => {
    const node = n as MapNode;
    if (node.kind === "tag") return "#d97706";
    switch (node.itemKind) {
      case "user_note":
        return "#9ca3af";
      case "saved_article":
        return "#3b82f6";
      case "uploaded_document":
        return "#10b981";
      default:
        return "#9ca3af";
    }
  }, []);

  const itemNodeSize = useCallback(
    (n: object) => ((n as MapNode).kind === "tag" ? 6 : 4),
    [],
  );

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
            graphData={graphData}
            width={dims.width}
            height={dims.height}
            nodeColor={itemNodeColor}
            nodeVal={itemNodeSize}
            nodeLabel={nodeLabel}
            linkColor={() => "rgba(120,120,120,0.22)"}
            linkWidth={0.5}
            backgroundColor="transparent"
            cooldownTime={1500}
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
              if (globalScale < 1.4) return; // bail before any string allocation
              const n = node as MapNode;
              const label = n.label.length > 36 ? n.label.slice(0, 36) + "…" : n.label;
              const fontSize = 11 / globalScale;
              ctx.font = `${fontSize}px Georgia, serif`;
              ctx.fillStyle = "rgba(160, 160, 160, 0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + 6);
            }}
          />
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-card/90 px-3 py-2 text-[11px] backdrop-blur">
          <div className="mb-1 font-medium text-muted-foreground">Legend</div>
          <div className="space-y-0.5">
            <LegendDot color="#d97706" label="Tag" />
            <LegendDot color="#3b82f6" label="Saved article" />
            <LegendDot color="#10b981" label="Uploaded doc" />
            <LegendDot color="#9ca3af" label="User note" />
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
              {selected.kind === "tag" ? "Tag" : "Item"}
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

              {selected.kind === "item" && detailLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}

              {selected.kind === "item" && detail && (
                <>
                  <p className="mt-1 text-xs text-muted-foreground capitalize">
                    {detail.kind.replace("_", " ")}
                  </p>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
                    {detail.content
                      ? detail.content.slice(0, 2000)
                      : "(no preview available)"}
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
                      onClick={() => router.push(`/directory?item=${detail.id}`)}
                    >
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

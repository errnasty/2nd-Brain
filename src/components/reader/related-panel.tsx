"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Newspaper, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type RelatedItem = {
  kind: "article" | "chunk";
  id: string;
  refId: string;
  title: string;
  snippet: string;
  similarity: number;
};

/**
 * Related-from-library panel. ON-DEMAND: nothing is fetched until the user
 * clicks "Show related". Auto-fetching on every article open ran an embedding
 * query each time and burned tokens for results the user rarely looked at.
 */
export function RelatedPanel({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<RelatedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  function load() {
    setOpened(true);
    setLoading(true);
    setError(null);
    setItems(null);

    fetch(`/api/related?articleId=${articleId}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          setItems([]);
        } else {
          setItems(data.items ?? []);
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load related items"))
      .finally(() => setLoading(false));
  }

  function selectItem(item: RelatedItem) {
    if (item.kind === "article") {
      const sp = new URLSearchParams(window.location.search);
      sp.set("article", item.refId);
      router.replace(`/feeds?${sp.toString()}`, { scroll: false });
    } else {
      router.push(`/documents?doc=${item.refId}`);
    }
  }

  const isConfigError =
    error && (error.includes("OPENAI_API_KEY") || error.includes("VOYAGE_API_KEY"));

  return (
    <div className="not-prose mt-10 border-t border-border pt-6">
      {!opened ? (
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Show related from your library
        </button>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Related from your library
          </div>

          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          )}

          {isConfigError && !loading && (
            <div className="text-xs text-muted-foreground">
              Embeddings aren&apos;t configured yet.
            </div>
          )}

          {error && !isConfigError && !loading && (
            <div className="text-xs text-muted-foreground">Couldn&apos;t load related items.</div>
          )}

          {!loading && items && items.length === 0 && !error && (
            <div className="text-xs text-muted-foreground">No related items found.</div>
          )}

          {items && items.length > 0 && (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    onClick={() => selectItem(item)}
                    className="group flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-accent/50"
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">
                      {item.kind === "article" ? (
                        <Newspaper className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug">{item.title}</div>
                      {item.snippet && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.snippet}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 self-center text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(item.similarity * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

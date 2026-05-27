"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function DailyBrief() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const stream = useCallback(async () => {
    setLoading(true);
    setError(null);
    setContent("");
    try {
      const res = await fetch("/api/brief", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        setError(text || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      if (!res.body) {
        setError("No response body");
        setLoading(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setContent((prev) => prev + decoder.decode(value, { stream: true }));
      }
      setGeneratedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brief");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    stream();
  }, [stream]);

  return (
    <article className="prose-reader max-w-none">
      <div className="not-prose mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? (
            <span>Generating…</span>
          ) : generatedAt ? (
            <span>
              Generated {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={stream} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Regenerate
        </Button>
      </div>

      {error && (
        <div className="not-prose rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Couldn&apos;t generate brief</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{error}</p>
          {error.includes("ANTHROPIC_API_KEY") && (
            <p className="mt-3 text-xs text-muted-foreground">
              Add an <code className="rounded bg-background px-1">ANTHROPIC_API_KEY</code> environment variable
              and redeploy.
            </p>
          )}
        </div>
      )}

      {loading && !content && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="h-3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {content && (
        <div className="whitespace-pre-wrap text-[1.05rem] leading-[1.85]">
          {content}
          {loading && <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-foreground/40 align-middle" />}
        </div>
      )}
    </article>
  );
}

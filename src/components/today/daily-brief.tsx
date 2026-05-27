"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Settings, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const PROMPT_STORAGE_KEY = "brief.systemPrompt.v1";

const DEFAULT_PROMPT_PLACEHOLDER = `You are my personal Second Brain curator. I already receive a highly detailed daily news summary via email, so your goal here is NOT to summarize everything. Your goal is rapid triage and discovery.

Review the provided JSON list of my unread articles and newly uploaded documents from the last 24 hours. Generate a short, punchy dashboard using the following strict format:

### High-Priority (Read Now)
Identify the 1-3 most substantial, unique, or high-signal pieces. 
* Provide the title (linked).
* Write a 1-sentence hook explaining exactly *why* it's worth my time. 
* List its primary tag.

### Thematic Clusters (For Batch Reading)
Group the remaining worthwhile articles into broad themes (e.g., "4 items on AI Tools", "2 items on Macroeconomics"). 
* Do not summarize the individual articles. 
* Just list the theme, the article count, and a 1-sentence summary of the overarching trend across those articles.

### Quick Clear (Low Signal / Skip)
Identify any articles that appear to be clickbait, standard PR announcements, highly repetitive news, or low-value fluff. 
* List their titles so I can confidently mark them as read or delete them without opening them.

Keep your tone sharp, objective, and extremely concise. Output in clean Markdown.`;

export function DailyBrief() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const hasMounted = useRef(false);

  // Load saved prompt from localStorage on mount
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    try {
      const saved = localStorage.getItem(PROMPT_STORAGE_KEY) ?? "";
      setSavedPrompt(saved);
      setCustomPrompt(saved);
    } catch {
      // ignore
    }
  }, []);

  const stream = useCallback(async (promptOverride?: string) => {
    setLoading(true);
    setError(null);
    setContent("");
    try {
      const systemPrompt = (promptOverride ?? savedPrompt).trim();
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(systemPrompt ? { systemPrompt } : {}),
        cache: "no-store",
      });
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
  }, [savedPrompt]);

  useEffect(() => {
    stream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function savePrompt() {
    try {
      const trimmed = customPrompt.trim();
      localStorage.setItem(PROMPT_STORAGE_KEY, trimmed);
      setSavedPrompt(trimmed);
      setSettingsOpen(false);
      toast.success(trimmed ? "Custom prompt saved" : "Reset to default prompt");
      // Regenerate with new prompt
      stream(trimmed);
    } catch {
      toast.error("Couldn't save prompt");
    }
  }

  function resetPrompt() {
    setCustomPrompt("");
  }

  return (
    <article className="prose-reader max-w-none">
      <div className="not-prose mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? (
            <span>Generating…</span>
          ) : generatedAt ? (
            <span>
              Generated {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {savedPrompt && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] normal-case tracking-normal">custom prompt</span>}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Customize the brief prompt"
          >
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            Prompt
          </Button>
          <Button size="sm" variant="ghost" onClick={() => stream()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Regenerate
          </Button>
        </div>
      </div>

      {settingsOpen && (
        <div className="not-prose mb-6 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Custom brief prompt</div>
            <button
              onClick={() => setSettingsOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            This replaces the default editor prompt. The model still receives your unread articles —
            you control the framing.
          </p>
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={DEFAULT_PROMPT_PLACEHOLDER}
            className="min-h-[140px] text-sm"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={resetPrompt}>
              Reset to default
            </Button>
            <Button size="sm" onClick={savePrompt}>
              Save &amp; regenerate
            </Button>
          </div>
        </div>
      )}

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

"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  FileText,
  Globe,
  Loader2,
  Newspaper,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, getChatModel } from "@/lib/ai/models";
import { SourceRow, SourceBadge } from "@/components/ui/source-list";
import { toast } from "sonner";

const MODEL_STORAGE_KEY = "ask.model.v1";

type Source = {
  n: number;
  directoryItemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  similarity: number;
};

type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };
type WebSource = { title: string; url: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  webSources?: WebSource[];
  usage?: Usage;
};

const USAGE_SENTINEL = "<<<SB_USAGE:";
const WEBSOURCES_SENTINEL = "<<<SB_WEBSOURCES:";

/** Index of the first sentinel marker present in the buffer, or -1. */
function firstSentinel(acc: string): number {
  const a = acc.indexOf(WEBSOURCES_SENTINEL);
  const b = acc.indexOf(USAGE_SENTINEL);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

const SUGGESTIONS = [
  "Summarize what I've read about AI safety this week",
  "Compare the macro takes across my saved economics articles",
  "What did the documents I uploaded last month say about pricing strategy?",
  "Find anything I have on Singapore semiconductor policy",
];

export function AskShell() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_CHAT_MODEL);
  const [web, setWeb] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Stable ref so memoized MessageBubbles don't re-render (and re-parse their
  // markdown) every time the messages array changes.
  const openSource = useCallback(
    (id: string) => router.push(`/directory?item=${id}`),
    [router],
  );

  // Persist the chosen model across visits
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && CHAT_MODELS.some((m) => m.id === saved)) setModelId(saved);
    } catch {
      // ignore
    }
  }, []);

  function chooseModel(id: string) {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  // "Refresh memory" — backfill embeddings so Ask can reference new content
  const refreshMemory = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("Indexing your library…");
    try {
      const res = await fetch("/api/embeddings/backfill", { method: "POST", cache: "no-store" });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        toast.error(text || `Backfill failed (HTTP ${res.status})`, { id: toastId });
        return;
      }
      // Stream progress; the last "DONE {json}" line carries the summary.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Show the latest non-heartbeat progress line.
        const lines = acc.split("\n").filter((l) => l && !l.startsWith("DONE") && l !== "·");
        const last = lines[lines.length - 1]?.replace(/·/g, "").trim();
        if (last) toast.loading(last, { id: toastId });
      }
      const doneLine = acc.split("\n").find((l) => l.startsWith("DONE "));
      if (doneLine) {
        const data = JSON.parse(doneLine.slice(5)) as {
          ok: boolean;
          total?: number;
          articlesEmbedded?: number;
          chunksEmbedded?: number;
          notesEmbedded?: number;
          failed?: number;
          errors?: string[];
          error?: string;
        };
        if (data.ok) {
          const parts = [
            (data.articlesEmbedded ?? 0) > 0 ? `${data.articlesEmbedded} articles` : null,
            (data.chunksEmbedded ?? 0) > 0 ? `${data.chunksEmbedded} doc chunks` : null,
            (data.notesEmbedded ?? 0) > 0 ? `${data.notesEmbedded} notes` : null,
          ].filter(Boolean);
          const failNote = (data.failed ?? 0) > 0 ? ` · ${data.failed} skipped` : "";
          toast.success(
            parts.length > 0
              ? `Indexed ${parts.join(", ")}${failNote}`
              : "Memory is already up to date",
            { id: toastId },
          );
          if (data.errors && data.errors.length > 0) {
            console.warn("Backfill phase errors:", data.errors);
          }
        } else {
          toast.error(data.error ?? "Backfill failed", { id: toastId });
        }
      } else {
        toast.success("Memory refresh finished", { id: toastId });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backfill failed", { id: toastId });
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setInput("");

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      // Reserve an assistant message for streaming into
      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: Message = { id: assistantId, role: "assistant", content: "" };

      // Prior history to send (excluding the new user message)
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setStreaming(true);

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, history, model: modelId, web }),
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text();
          setError(text || `HTTP ${res.status}`);
          // Remove the placeholder assistant message
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        // Pull source map from the response header (base64-encoded JSON)
        const rawSources = res.headers.get("x-rag-sources");
        let sources: Source[] = [];
        if (rawSources) {
          try {
            sources = JSON.parse(atob(rawSources));
          } catch {
            // ignore
          }
        }

        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        // Coalesce renders to one per animation frame instead of one per chunk
        // — avoids O(messages) re-renders on every token during long answers.
        let frameQueued = false;
        const flush = () => {
          frameQueued = false;
          const sentinelIdx = firstSentinel(acc);
          const display = sentinelIdx >= 0 ? acc.slice(0, sentinelIdx) : acc;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: display } : m)),
          );
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (!frameQueued) {
            frameQueued = true;
            requestAnimationFrame(flush);
          }
        }
        flush(); // ensure the final chunk is committed

        // Parse the trailing sentinels: web sources (cited URLs) + usage.
        let usage: Usage | undefined;
        let webSources: WebSource[] | undefined;
        const wIdx = acc.indexOf(WEBSOURCES_SENTINEL);
        const uIdx = acc.indexOf(USAGE_SENTINEL);
        if (wIdx >= 0) {
          const end = uIdx > wIdx ? uIdx : acc.length;
          try {
            webSources = JSON.parse(acc.slice(wIdx + WEBSOURCES_SENTINEL.length, end)) as WebSource[];
          } catch {
            // ignore malformed web sources
          }
        }
        if (uIdx >= 0) {
          try {
            usage = JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage;
          } catch {
            // ignore malformed usage
          }
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, sources, webSources, usage } : m)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [messages, streaming, modelId, web],
  );

  function clearChat() {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles className="h-4 w-4" /> Ask your Second Brain
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Answers grounded in your Directory — uploaded documents and saved articles. Citations
            point back to the source items.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={refreshMemory}
            disabled={refreshing}
            title="Re-index your library so Ask can reference new notes, docs, and articles"
          >
            {refreshing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refresh memory
          </Button>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearChat} disabled={streaming}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <Empty onPick={(s) => send(s)} />
        ) : (
          <div className="space-y-6">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onOpenSource={openSource} />
            ))}
            {streaming && (
              <div className="text-xs text-muted-foreground">
                <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" />
                Thinking…
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">Couldn&apos;t answer</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{error}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card/30 px-6 py-4">
        {/* Model selector */}
        <div className="mb-2 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={streaming}>
                <Cpu className="h-3.5 w-3.5" />
                {getChatModel(modelId).label}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CHAT_MODELS.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => chooseModel(m.id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex flex-col">
                    <span>{m.label}</span>
                    {m.hint && <span className="text-[10px] text-muted-foreground">{m.hint}</span>}
                  </span>
                  {modelId === m.id && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant={web ? "default" : "outline"}
            onClick={() => setWeb((w) => !w)}
            disabled={streaming}
            className="h-7 gap-1.5 text-xs"
            title={web ? "Web search on — Claude may search the web (uses a Claude model)" : "Web search off"}
          >
            <Globe className="h-3.5 w-3.5" /> Web
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="relative"
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything across your Directory…"
            className="min-h-[56px] resize-none pr-12 text-[15px]"
            disabled={streaming}
          />
          <Button
            type="submit"
            size="icon"
            className="absolute bottom-2 right-2 h-8 w-8"
            disabled={streaming || !input.trim()}
            title="Send (Enter)"
          >
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </Button>
        </form>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <Sparkles className="h-10 w-10 text-muted-foreground/40" />
      <p className="max-w-md text-sm text-muted-foreground">
        Ask a question and I&apos;ll search your saved articles and uploaded documents for an
        answer, with citations back to the source.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-lg border border-border bg-card p-3 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  onOpenSource,
}: {
  message: Message;
  onOpenSource: (directoryItemId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-accent px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="prose-reader text-[15px] leading-[1.75]">
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        ) : (
          <span className="text-muted-foreground italic">…</span>
        )}
      </div>
      {message.usage && message.usage.totalTokens > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5">
            Tokens consumed: {message.usage.totalTokens.toLocaleString()}
          </span>
          <span className="opacity-60">
            ({message.usage.promptTokens.toLocaleString()} in ·{" "}
            {message.usage.completionTokens.toLocaleString()} out)
          </span>
        </div>
      )}
      {message.sources && message.sources.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sources</div>
          {message.sources.map((s) => (
            <SourceRow
              key={s.directoryItemId + s.n}
              badge={<SourceBadge n={s.n} />}
              icon={<KindIcon kind={s.kind} />}
              title={s.title}
              trailing={
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(s.similarity * 100)}%
                </span>
              }
              onClick={() => onOpenSource(s.directoryItemId)}
            />
          ))}
        </div>
      )}
      {message.webSources && message.webSources.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Globe className="h-3 w-3" /> Web sources
          </div>
          {message.webSources.map((s) => (
            <SourceRow
              key={s.url}
              icon={<Globe className="h-3 w-3 shrink-0 text-muted-foreground" />}
              title={s.title}
              href={s.url}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function KindIcon({ kind }: { kind: Source["kind"] }) {
  const cls = "h-3 w-3 shrink-0 text-muted-foreground";
  if (kind === "saved_article") return <Newspaper className={cls} />;
  if (kind === "uploaded_document") return <FileText className={cls} />;
  return <NotebookPen className={cls} />;
}

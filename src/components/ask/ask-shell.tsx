"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  FileText,
  Loader2,
  Newspaper,
  NotebookPen,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Source = {
  n: number;
  directoryItemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  similarity: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
          body: JSON.stringify({ question: trimmed, history }),
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
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
          );
        }
        // Attach sources once streaming completes
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, sources } : m)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [messages, streaming],
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
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clearChat} disabled={streaming}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <Empty onPick={(s) => send(s)} />
        ) : (
          <div className="space-y-6">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenSource={(id) => router.push(`/directory?item=${id}`)}
              />
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

function MessageBubble({
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
      {message.sources && message.sources.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sources</div>
          {message.sources.map((s) => (
            <button
              key={s.directoryItemId + s.n}
              onClick={() => onOpenSource(s.directoryItemId)}
              className="group flex w-full items-center gap-2 rounded-md p-2 text-left text-xs transition-colors hover:bg-accent/50"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {s.n}
              </span>
              <KindIcon kind={s.kind} />
              <span className="flex-1 truncate group-hover:underline">{s.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {Math.round(s.similarity * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KindIcon({ kind }: { kind: Source["kind"] }) {
  const cls = "h-3 w-3 shrink-0 text-muted-foreground";
  if (kind === "saved_article") return <Newspaper className={cls} />;
  if (kind === "uploaded_document") return <FileText className={cls} />;
  return <NotebookPen className={cls} />;
}

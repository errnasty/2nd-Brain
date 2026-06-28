"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  BookmarkPlus,
  Check,
  CalendarDays,
  ChevronDown,
  Copy,
  Cpu,
  FileText,
  Globe,
  GraduationCap,
  Loader2,
  MessageCircle,
  Mic,
  Newspaper,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createNoteAction } from "@/app/(app)/directory/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, getChatModel } from "@/lib/ai/models";
import { USAGE_SENTINEL, WEBSOURCES_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import { generateFlashcardsAction } from "@/app/(app)/review/actions";
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
type StudyPlanResult = {
  itemId: string;
  title: string;
  taskCount: number;
  fromISO: string;
  toISO: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  webSources?: WebSource[];
  usage?: Usage;
  plan?: StudyPlanResult;
};

const SUGGESTIONS = [
  "Summarize what I've read about AI safety this week",
  "Compare the macro takes across my saved economics articles",
  "What did the documents I uploaded last month say about pricing strategy?",
  "Find anything I have on Singapore semiconductor policy",
];

// ── Voice input (#9) — Web Speech API, browser-only, feature-detected ───
type SpeechResultLike = { 0: { transcript: string }; isFinal: boolean };
type SpeechEventLike = { results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Numbered footnote block for an answer's sources (shared by Copy + Save-as-note). */
function answerToMarkdown(message: Message): string {
  let md = message.content ?? "";
  const foot: string[] = [];
  if (message.sources?.length) for (const s of message.sources) foot.push(`[${s.n}] ${s.title}`);
  if (message.webSources?.length) for (const s of message.webSources) foot.push(`- ${s.title} — ${s.url}`);
  if (foot.length) md += `\n\n## Sources\n${foot.join("\n")}`;
  return md;
}

export function AskShell() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_CHAT_MODEL);
  const [web, setWeb] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [studyMode, setStudyMode] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("5");
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef("");
  const voiceSupported = useMemo(() => getSpeechRecognition() !== null, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  // #9 Dictate into the composer. Toggles a one-shot recognition session and
  // appends the live transcript onto whatever was already typed.
  const toggleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser");
      return;
    }
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    voiceBaseRef.current = input ? input.trimEnd() + " " : "";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setInput(voiceBaseRef.current + transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  }, [listening, input]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const openSource = useCallback(
    (id: string) => router.push(`/directory?item=${id}`),
    [router],
  );
  const openPath = useCallback((path: string) => router.push(path), [router]);

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
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
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
      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: Message = { id: assistantId, role: "assistant", content: "" };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setStreaming(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, history, model: modelId, web }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          setError(text || `HTTP ${res.status}`);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

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

        let frameQueued = false;
        const flush = () => {
          frameQueued = false;
          const display = displayText(acc);
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
        flush();

        let usage: Usage | undefined;
        let webSources: WebSource[] | undefined;
        const wIdx = acc.indexOf(WEBSOURCES_SENTINEL);
        const uIdx = acc.indexOf(USAGE_SENTINEL);
        if (wIdx >= 0) {
          const end = uIdx > wIdx ? uIdx : acc.length;
          try {
            webSources = JSON.parse(acc.slice(wIdx + WEBSOURCES_SENTINEL.length, end)) as WebSource[];
          } catch {
            // ignore
          }
        }
        if (uIdx >= 0) {
          try {
            usage = JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage;
          } catch {
            // ignore
          }
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, sources, webSources, usage } : m)),
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [messages, streaming, modelId, web],
  );

  const sendStudyPlan = useCallback(
    async (goal: string) => {
      const trimmed = goal.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setInput("");
      const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMessage]);
      setStreaming(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/study-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: trimmed,
            deadline: deadline || undefined,
            hoursPerWeek: Number(hoursPerWeek) || undefined,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as Partial<StudyPlanResult> & {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.itemId) {
          setError(data.error || `HTTP ${res.status}`);
          return;
        }
        const plan: StudyPlanResult = {
          itemId: data.itemId,
          title: data.title ?? "Study plan",
          taskCount: data.taskCount ?? 0,
          fromISO: data.fromISO ?? "",
          toISO: data.toISO ?? "",
        };
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: "", plan },
        ]);
        void generateFlashcardsAction(plan.itemId).catch(() => {});
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [streaming, deadline, hoursPerWeek],
  );

  function clearChat() {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  // Conversation title for the header — first user message if there is one.
  const threadTitle = useMemo(() => {
    const first = messages.find((m) => m.role === "user")?.content?.trim() ?? "";
    if (!first) return "New conversation";
    return first.length > 80 ? `${first.slice(0, 80)}…` : first;
  }, [messages]);

  const totalCitations = useMemo(() => {
    let n = 0;
    for (const m of messages) {
      if (m.sources) n += m.sources.length;
      if (m.webSources) n += m.webSources.length;
    }
    return n;
  }, [messages]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* ── Editorial header ──────────────────────────────────────── */}
      <header className="border-b border-border px-6 pt-5 pb-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 editorial-eyebrow">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="h-3 w-3" /> Conversation
            {totalCitations > 0 && (
              <span className="ml-2 normal-case italic" style={{ letterSpacing: 0 }}>
                · {totalCitations} {totalCitations === 1 ? "source" : "sources"} cited
              </span>
            )}
          </span>
          <span style={{ color: "hsl(var(--brand))" }}>Grounded in your library</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h1
            className="editorial-display m-0 truncate"
            style={{ fontSize: "clamp(1.25rem, 2.6vw, 1.625rem)" }}
            title={threadTitle}
          >
            {threadTitle}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
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
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <Empty onPick={(s) => send(s)} />
        ) : (
          <div className="space-y-7">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onOpenSource={openSource} onOpenPath={openPath} />
            ))}
            {streaming && (
              <div className="flex items-center gap-2 text-xs italic text-muted-foreground">
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ background: "hsl(var(--brand))" }}
                />
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

      {/* Composer */}
      <div className="border-t border-border bg-accent/20 px-6 py-4">
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
            disabled={streaming || studyMode}
            className="h-7 gap-1.5 text-xs"
            title={web ? "Web search on" : "Web search off"}
          >
            <Globe className="h-3.5 w-3.5" /> Web
          </Button>
          <Button
            size="sm"
            variant={studyMode ? "brand" : "outline"}
            onClick={() => setStudyMode((s) => !s)}
            disabled={streaming}
            className="h-7 gap-1.5 text-xs"
            title="Turn your prompt into a dated study plan"
          >
            <GraduationCap className="h-3.5 w-3.5" /> Study plan
          </Button>
          {voiceSupported && (
            <Button
              size="sm"
              variant={listening ? "brand" : "outline"}
              onClick={toggleVoice}
              disabled={streaming}
              className="h-7 gap-1.5 text-xs"
              title={listening ? "Stop dictation" : "Dictate your question"}
            >
              <Mic className={cn("h-3.5 w-3.5", listening && "animate-pulse")} />
              {listening ? "Listening…" : "Voice"}
            </Button>
          )}
        </div>
        {studyMode && (
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              Deadline
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={streaming}
                className="h-7 rounded-md border border-border bg-background px-2 text-foreground"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Hours / week
              <input
                type="number"
                min={1}
                max={40}
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(e.target.value)}
                disabled={streaming}
                className="h-7 w-16 rounded-md border border-border bg-background px-2 text-foreground tabular-nums"
              />
            </label>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (studyMode) sendStudyPlan(input);
            else send(input);
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
                if (studyMode) sendStudyPlan(input);
                else send(input);
              }
            }}
            placeholder={
              studyMode
                ? "Describe your study goal… e.g. Master React hooks"
                : "Ask anything across your Directory…"
            }
            className="min-h-[64px] resize-none rounded-xl pr-12 text-[15px]"
            disabled={streaming}
          />
          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="brand"
              className="absolute bottom-2 right-2 h-8 w-8"
              onClick={stop}
              title="Stop generating"
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              variant="brand"
              className="absolute bottom-2 right-2 h-8 w-8"
              disabled={!input.trim()}
              title="Send (Enter)"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </form>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="editorial-eyebrow-brand">§ Start a conversation</div>
      <Sparkles className="h-10 w-10 text-muted-foreground/40" />
      <p className="max-w-md text-sm italic text-muted-foreground">
        Ask a question and Claude will search your saved articles, notes, and documents — with
        citations back to the source.
      </p>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-left text-sm text-foreground/85 transition-all hover:border-brand/40 hover:bg-accent"
          >
            <span
              className="mt-px font-mono text-[10px] font-semibold tabular-nums"
              style={{ color: "hsl(var(--brand))" }}
            >
              [{String(i + 1).padStart(2, "0")}]
            </span>
            <span className="flex-1 leading-snug">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ACTION_BTN =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/**
 * #6 Grounding-strength meter. Blends how many library sources backed the answer
 * with their average similarity into a 5-bar readout (weak → strong). Web-only
 * answers read as "moderate"; an answer with no citations reads as "ungrounded".
 */
function GroundingMeter({ message }: { message: Message }) {
  const sources = message.sources ?? [];
  const web = message.webSources ?? [];
  if (sources.length === 0 && web.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
        title="No sources were cited for this answer"
      >
        Ungrounded
      </span>
    );
  }
  const avgSim = sources.length
    ? sources.reduce((s, x) => s + x.similarity, 0) / sources.length
    : 0;
  let filled: number;
  if (sources.length === 0) {
    filled = 2; // web-only
  } else {
    const countPart = (Math.min(sources.length, 4) / 4) * 2; // 0–2
    const simPart = avgSim * 3; // 0–3
    filled = Math.max(1, Math.min(5, Math.round(countPart + simPart)));
  }
  const label = filled >= 4 ? "Strong" : filled >= 3 ? "Moderate" : "Weak";
  const tip =
    sources.length > 0
      ? `${label} grounding · ${sources.length} ${sources.length === 1 ? "source" : "sources"} · avg ${Math.round(avgSim * 100)}% match`
      : `${label} grounding · ${web.length} web ${web.length === 1 ? "source" : "sources"}`;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
      title={tip}
    >
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{
              height: `${4 + i * 2}px`,
              background: i < filled ? "hsl(var(--brand))" : "hsl(var(--muted-foreground) / 0.25)",
            }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}

/**
 * #7 Per-message action row: copy as Markdown, save the answer as a note, and a
 * 👍/👎 feedback toggle.
 */
function MessageActions({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  function copy() {
    navigator.clipboard
      ?.writeText(answerToMarkdown(message))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  async function saveAsNote() {
    if (saving || saved) return;
    setSaving(true);
    // Title = first non-empty line of the answer, trimmed of markdown heading marks.
    const firstLine =
      (message.content ?? "")
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0) ?? "Saved answer";
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
    try {
      const res = await createNoteAction({ title, content: answerToMarkdown(message) });
      if (res.ok) {
        setSaved(true);
        toast.success("Saved to your notes");
      } else {
        toast.error(res.error ?? "Couldn't save note");
      }
    } catch {
      toast.error("Couldn't save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
      <button onClick={copy} title="Copy as Markdown" className={ACTION_BTN}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button onClick={saveAsNote} disabled={saving || saved} title="Save this answer as a note" className={ACTION_BTN}>
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
        {saved ? "Saved" : "Save as note"}
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={() => setVote((v) => (v === "up" ? null : "up"))}
          title="Helpful"
          aria-pressed={vote === "up"}
          className={cn(ACTION_BTN, vote === "up" && "text-brand")}
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => setVote((v) => (v === "down" ? null : "down"))}
          title="Not helpful"
          aria-pressed={vote === "down"}
          className={cn(ACTION_BTN, vote === "down" && "text-destructive")}
        >
          <ThumbsDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  onOpenSource,
  onOpenPath,
}: {
  message: Message;
  onOpenSource: (directoryItemId: string) => void;
  onOpenPath: (path: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-snug">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.plan) {
    const p = message.plan;
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="editorial-eyebrow-brand inline-flex items-center gap-2">
          <GraduationCap className="h-3 w-3" /> § Study plan created
        </div>
        <div className="editorial-display mt-2 text-lg" style={{ letterSpacing: "-0.014em" }}>
          {p.title}
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
          <span>{p.taskCount} sessions</span>
          {p.fromISO && p.toISO && (
            <>
              <span className="opacity-50">·</span>
              <span>
                {p.fromISO} → {p.toISO}
              </span>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="brand" onClick={() => onOpenPath(`/directory?item=${p.itemId}`)}>
            <NotebookPen className="mr-1.5 h-3.5 w-3.5" /> Open note
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenPath("/study?tab=calendar")}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> View calendar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="editorial-eyebrow-brand inline-flex items-center gap-2">
          <Sparkles className="h-3 w-3" /> § Answer
          {message.sources && message.sources.length > 0 && (
            <span className="text-muted-foreground" style={{ letterSpacing: 0, textTransform: "none" }}>
              <span className="opacity-50">·</span> grounded in {message.sources.length} {message.sources.length === 1 ? "source" : "sources"}
            </span>
          )}
        </div>
        {message.content && <GroundingMeter message={message} />}
      </div>
      <div className="prose-reader max-w-[70ch] text-[15px] leading-[1.7]">
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        ) : (
          <span className="text-muted-foreground italic">…</span>
        )}
      </div>
      {message.usage && message.usage.totalTokens > 0 && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
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
          <div className="editorial-eyebrow-brand inline-flex items-center gap-2 pb-1">
            <Newspaper className="h-3 w-3" /> § Sources
          </div>
          {message.sources.map((s) => (
            <SourceRow
              key={s.directoryItemId + s.n}
              badge={<SourceBadge n={s.n} />}
              icon={<KindIcon kind={s.kind} />}
              title={s.title}
              trailing={
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
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
          <div className="editorial-eyebrow-brand inline-flex items-center gap-2 pb-1">
            <Globe className="h-3 w-3" /> § Web sources
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
      {message.content && <MessageActions message={message} />}
    </div>
  );
});

function KindIcon({ kind }: { kind: Source["kind"] }) {
  const cls = "h-3 w-3 shrink-0 text-muted-foreground";
  if (kind === "saved_article") return <Newspaper className={cls} />;
  if (kind === "uploaded_document") return <FileText className={cls} />;
  return <NotebookPen className={cls} />;
}

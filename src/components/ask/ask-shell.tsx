"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CitedMarkdown } from "@/components/ui/cited-markdown";
import {
  ArrowUp,
  BookmarkPlus,
  Brain,
  Check,
  CalendarDays,
  ChevronDown,
  CornerDownRight,
  Copy,
  Cpu,
  FileText,
  Globe,
  GraduationCap,
  Loader2,
  Menu,
  Mic,
  Newspaper,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Square,
  ThumbsDown,
  ThumbsUp,
  X,
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
import { ASK_MODEL_KEY, getScopedItem, setScopedItem } from "@/lib/settings";
import { USAGE_SENTINEL, WEBSOURCES_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import { generateFlashcardsAction, createFlashcardAction } from "@/app/(app)/review/actions";
import { searchAttachableItemsAction, type AttachableItem } from "@/app/(app)/ask/actions";
import { fetchDirectoryItemByIdAction } from "@/app/(app)/directory/actions";
import {
  appendMessage,
  createThread,
  deleteThread,
  listThreads,
  loadThread,
  renameThread,
  type ThreadMessage,
  type ThreadSummary,
} from "@/app/(app)/ask/thread-actions";
import { ThreadList } from "@/components/ask/thread-list";
import { SourceRow, SourceBadge } from "@/components/ui/source-list";
import { toast } from "sonner";

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

type Verification =
  | "loading"
  | { verdict: "supported" | "partial" | "unsupported" | "unknown"; issues: string[] };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  webSources?: WebSource[];
  usage?: Usage;
  plan?: StudyPlanResult;
  followups?: string[];
  verification?: Verification;
};

const SUGGESTIONS = [
  "Summarize what I've read about AI safety this week",
  "Compare the macro takes across my saved economics articles",
  "What did the documents I uploaded last month say about pricing strategy?",
  "Find anything I have on Singapore semiconductor policy",
];

/** Hydrate a persisted message into the client shape. */
function hydrate(m: ThreadMessage): Message {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    sources: m.sources.length ? m.sources : undefined,
    webSources: m.webSources.length ? m.webSources : undefined,
    usage: m.usage ?? undefined,
  };
}

// ── Voice input — Web Speech API, browser-only, feature-detected ────────
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

export function AskShell({
  initialThreads,
  activeThreadId,
  initialMessages,
  initialPrefill,
  initialAttachId,
}: {
  initialThreads: ThreadSummary[];
  activeThreadId: string | null;
  initialMessages: ThreadMessage[];
  /** Cross-surface hand-off: /ask?prefill=…&attach=<directoryItemId>. */
  initialPrefill?: string;
  initialAttachId?: string;
}) {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(activeThreadId);
  const [messages, setMessages] = useState<Message[]>(() => initialMessages.map(hydrate));
  const [switching, setSwitching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_CHAT_MODEL);
  const [web, setWeb] = useState(false);
  const [verifyMode, setVerifyMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [studyMode, setStudyMode] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("5");
  const [listening, setListening] = useState(false);
  const [contextItems, setContextItems] = useState<AttachableItem[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
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

  // Refresh the sidebar list from the server (after create/rename/delete).
  const refreshThreads = useCallback(() => {
    void listThreads().then(setThreads).catch(() => {});
  }, []);

  // ── Thread navigation (client-side for instant switching; URL kept in sync
  // via history.replaceState so a conversation is resumable/shareable). ──
  const selectThread = useCallback(
    async (id: string) => {
      if (id === threadId || streaming) {
        setDrawerOpen(false);
        return;
      }
      setDrawerOpen(false);
      setSwitching(true);
      try {
        const t = await loadThread(id);
        if (t) {
          setThreadId(id);
          setMessages(t.messages.map(hydrate));
          window.history.replaceState(null, "", `/ask?thread=${id}`);
        }
      } finally {
        setSwitching(false);
      }
    },
    [threadId, streaming],
  );

  const newChat = useCallback(() => {
    if (streaming) return;
    setDrawerOpen(false);
    setThreadId(null);
    setMessages([]);
    setError(null);
    window.history.replaceState(null, "", "/ask");
    inputRef.current?.focus();
  }, [streaming]);

  const removeThread = useCallback(
    async (id: string) => {
      setThreads((prev) => prev.filter((t) => t.id !== id));
      await deleteThread(id).catch(() => {});
      if (id === threadId) newChat();
    },
    [threadId, newChat],
  );

  const renameThreadTitle = useCallback((id: string, title: string) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    void renameThread(id, title).catch(() => {});
  }, []);

  // Voice dictation.
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

  const openSource = useCallback((id: string) => router.push(`/directory?item=${id}`), [router]);
  const openPath = useCallback((path: string) => router.push(path), [router]);

  useEffect(() => {
    const saved = getScopedItem(ASK_MODEL_KEY);
    if (saved && CHAT_MODELS.some((m) => m.id === saved)) setModelId(saved);
  }, []);

  // Cross-surface hand-off: a question pre-typed and/or an item pinned as
  // context (e.g. the reader's "Ask about this"). Applied once on mount.
  useEffect(() => {
    if (initialPrefill) {
      setInput(initialPrefill);
      inputRef.current?.focus();
    }
    if (initialAttachId) {
      fetchDirectoryItemByIdAction(initialAttachId)
        .then((item) => {
          if (item) {
            setContextItems((prev) =>
              prev.some((p) => p.id === item.id) ? prev : [...prev, { id: item.id, title: item.title, kind: item.kind }],
            );
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseModel(id: string) {
    setModelId(id);
    setScopedItem(ASK_MODEL_KEY, id);
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
            parts.length > 0 ? `Indexed ${parts.join(", ")}${failNote}` : "Memory is already up to date",
            { id: toastId },
          );
          if (data.errors && data.errors.length > 0) console.warn("Backfill phase errors:", data.errors);
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

  /** Ensure a thread exists before persisting the first turn; returns its id. */
  const ensureThread = useCallback(
    async (firstQuestion: string): Promise<string | null> => {
      if (threadId) return threadId;
      const r = await createThread();
      if (!r.ok) return null;
      setThreadId(r.id);
      window.history.replaceState(null, "", `/ask?thread=${r.id}`);
      // Optimistically add to the sidebar (title filled from the first question).
      const title = firstQuestion.trim().slice(0, 80) || "New conversation";
      setThreads((prev) => [{ id: r.id, title, updatedAt: new Date().toISOString() }, ...prev]);
      return r.id;
    },
    [threadId],
  );

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setInput("");

      const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: Message = { id: assistantId, role: "assistant", content: "" };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setStreaming(true);

      // Persist the user turn immediately (survives a mid-stream failure).
      const tid = await ensureThread(trimmed);
      if (tid) void appendMessage({ threadId: tid, role: "user", content: trimmed }).catch(() => {});

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            history,
            model: modelId,
            web,
            contextIds: contextItems.map((c) => c.id),
          }),
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
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: display } : m)));
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
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, sources, webSources, usage } : m)));

        const finalAnswer = displayText(acc);

        // Opt-in faithfulness check — verify the answer against its cited
        // library sources (non-blocking, fail-soft).
        if (verifyMode && sources.length > 0 && finalAnswer.trim()) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, verification: "loading" } : m)));
          void fetch("/api/ask/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: finalAnswer, sourceIds: sources.map((s) => s.directoryItemId) }),
          })
            .then((r) => r.json())
            .then((v: { verdict?: string; issues?: string[] }) => {
              const verdict = (["supported", "partial", "unsupported"].includes(v.verdict ?? "")
                ? v.verdict
                : "unknown") as "supported" | "partial" | "unsupported" | "unknown";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, verification: { verdict, issues: v.issues ?? [] } } : m,
                ),
              );
            })
            .catch(() => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, verification: { verdict: "unknown", issues: [] } } : m,
                ),
              );
            });
        }
        // Persist the assistant turn + bump this thread to the top of the list.
        if (tid && finalAnswer.trim()) {
          void appendMessage({
            threadId: tid,
            role: "assistant",
            content: finalAnswer,
            sources,
            webSources,
            usage: usage ?? null,
            model: modelId,
          }).then(() => refreshThreads()).catch(() => {});
        }

        // Suggested follow-ups (non-blocking, fail-soft).
        if (finalAnswer.trim()) {
          void fetch("/api/ask/followups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: trimmed, answer: finalAnswer }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (Array.isArray(d?.followups) && d.followups.length) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, followups: d.followups } : m)));
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        inputRef.current?.focus();
      }
    },
    [messages, streaming, modelId, web, verifyMode, contextItems, ensureThread, refreshThreads],
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
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "", plan }]);
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

  function submit() {
    if (studyMode) sendStudyPlan(input);
    else send(input);
  }

  const activeToolCount =
    (web ? 1 : 0) + (studyMode ? 1 : 0) + (verifyMode ? 1 : 0) + (contextItems.length > 0 ? 1 : 0);

  return (
    <div className="flex h-full min-h-0">
      {/* Desktop thread sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border lg:flex">
        <ThreadList
          threads={threads}
          activeId={threadId}
          onSelect={selectThread}
          onNew={newChat}
          onRename={renameThreadTitle}
          onDelete={removeThread}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl transition-transform duration-200 lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold">Chats</span>
          <button onClick={() => setDrawerOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ThreadList
            threads={threads}
            activeId={threadId}
            onSelect={selectThread}
            onNew={newChat}
            onRename={renameThreadTitle}
            onDelete={removeThread}
          />
        </div>
      </aside>

      {/* Chat pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
            aria-label="Conversations"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="inline-flex items-center gap-1.5 editorial-eyebrow">
            <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--brand))" }} /> Ask
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshMemory}
              disabled={refreshing}
              title="Re-index your library so Ask can reference new notes, docs, and articles"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Refresh memory</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={newChat} disabled={streaming} title="New chat" className="lg:hidden">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            {switching ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <Empty onPick={(s) => send(s)} />
            ) : (
              <div className="space-y-7">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    question={
                      m.role === "assistant" && messages[i - 1]?.role === "user"
                        ? messages[i - 1].content
                        : undefined
                    }
                    onOpenSource={openSource}
                    onOpenPath={openPath}
                    onFollowup={send}
                  />
                ))}
                {streaming && (
                  <div className="flex items-center gap-2 text-xs italic text-muted-foreground">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "hsl(var(--brand))" }} />
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
        </div>

        {/* Composer */}
        <div
          className="border-t border-border bg-accent/20 px-4 pt-3 sm:px-6"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-3xl">
            {attachOpen && (
              <AttachContextPanel
                attachedIds={contextItems.map((c) => c.id)}
                onAdd={(item) =>
                  setContextItems((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item]))
                }
                onClose={() => setAttachOpen(false)}
              />
            )}
            {contextItems.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {contextItems.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[12px]"
                    title={c.title}
                  >
                    <KindIcon kind={c.kind} />
                    <span className="max-w-[180px] truncate">{c.title}</span>
                    <button
                      onClick={() => setContextItems((prev) => prev.filter((p) => p.id !== c.id))}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
                submit();
              }}
              className="relative rounded-2xl border border-border bg-background focus-within:ring-1 focus-within:ring-ring"
            >
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  studyMode ? "Describe your study goal… e.g. Master React hooks" : "Ask anything across your Directory…"
                }
                className="min-h-[56px] resize-none border-0 bg-transparent px-3.5 pt-3 pb-12 text-[15px] shadow-none focus-visible:ring-0"
                disabled={streaming}
              />
              {/* Composer toolbar (inside the input frame) */}
              <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
                {/* Model picker */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" disabled={streaming}>
                      <Cpu className="h-3.5 w-3.5" />
                      <span className="hidden max-w-[120px] truncate sm:inline">{getChatModel(modelId).label}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="w-56">
                    <DropdownMenuLabel>Model</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {CHAT_MODELS.map((m) => (
                      <DropdownMenuItem key={m.id} onClick={() => chooseModel(m.id)} className="flex items-center justify-between gap-2">
                        <span className="flex flex-col">
                          <span>{m.label}</span>
                          {m.hint && <span className="text-[10px] text-muted-foreground">{m.hint}</span>}
                        </span>
                        {modelId === m.id && <Check className="h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Tools (Web / Study plan / Voice / Context) consolidated so the
                    composer stays uncluttered on mobile. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant={activeToolCount > 0 ? "brand" : "ghost"}
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={streaming}
                      title="Tools"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Tools</span>
                      {activeToolCount > 0 && <span className="tabular-nums">· {activeToolCount}</span>}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="w-52">
                    <DropdownMenuLabel>Tools</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        if (!studyMode) setWeb((w) => !w);
                      }}
                      className="justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" /> Web search
                      </span>
                      {web && <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setVerifyMode((v) => !v);
                      }}
                      className="justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5" /> Verify answers
                      </span>
                      {verifyMode && <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setStudyMode((s) => !s);
                      }}
                      className="justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <GraduationCap className="h-3.5 w-3.5" /> Study plan
                      </span>
                      {studyMode && <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setAttachOpen((v) => !v);
                      }}
                      className="justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5" /> Attach context
                      </span>
                      {contextItems.length > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{contextItems.length}</span>}
                    </DropdownMenuItem>
                    {voiceSupported && (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleVoice();
                        }}
                        className="justify-between"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Mic className={cn("h-3.5 w-3.5", listening && "animate-pulse")} /> {listening ? "Listening…" : "Voice"}
                        </span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="ml-auto">
                  {streaming ? (
                    <Button type="button" size="icon" variant="brand" className="h-8 w-8" onClick={stop} title="Stop generating">
                      <Square className="h-3 w-3 fill-current" />
                    </Button>
                  ) : (
                    <Button type="submit" size="icon" variant="brand" className="h-8 w-8" disabled={!input.trim()} title="Send (Enter)">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            <p className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground">
              Enter to send · Shift+Enter for newline · grounded in your library
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="editorial-eyebrow-brand">§ Start a conversation</div>
      <Sparkles className="h-10 w-10 text-muted-foreground/40" />
      <p className="max-w-md text-sm italic text-muted-foreground">
        Ask a question and Claude will search your saved articles, notes, and documents — with citations back to the
        source.
      </p>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-left text-sm text-foreground/85 transition-all hover:border-brand/40 hover:bg-accent"
          >
            <span className="mt-px font-mono text-[10px] font-semibold tabular-nums" style={{ color: "hsl(var(--brand))" }}>
              [{String(i + 1).padStart(2, "0")}]
            </span>
            <span className="flex-1 leading-snug">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Picker panel: search recent directory items and attach them as context. */
function AttachContextPanel({
  attachedIds,
  onAdd,
  onClose,
}: {
  attachedIds: string[];
  onAdd: (item: AttachableItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AttachableItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchAttachableItemsAction(query)
        .then((r) => {
          if (!cancelled) setItems(r);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="mb-2 rounded-lg border border-border bg-card p-2 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items to attach…"
          className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none"
        />
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs italic text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-3 text-xs italic text-muted-foreground">No items found.</div>
        ) : (
          items.map((it) => {
            const added = attachedIds.includes(it.id);
            return (
              <button
                key={it.id}
                onClick={() => onAdd(it)}
                disabled={added}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors",
                  added ? "text-muted-foreground" : "hover:bg-accent",
                )}
              >
                <KindIcon kind={it.kind} />
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                {added && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--brand))" }} />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const ACTION_BTN =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** Grounding-strength meter — blends source count with average similarity. */
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
  const avgSim = sources.length ? sources.reduce((s, x) => s + x.similarity, 0) / sources.length : 0;
  let filled: number;
  if (sources.length === 0) {
    filled = 2; // web-only
  } else {
    const countPart = (Math.min(sources.length, 4) / 4) * 2;
    const simPart = avgSim * 3;
    filled = Math.max(1, Math.min(5, Math.round(countPart + simPart)));
  }
  const label = filled >= 4 ? "Strong" : filled >= 3 ? "Moderate" : "Weak";
  const tip =
    sources.length > 0
      ? `${label} grounding · ${sources.length} ${sources.length === 1 ? "source" : "sources"} · avg ${Math.round(avgSim * 100)}% match`
      : `${label} grounding · ${web.length} web ${web.length === 1 ? "source" : "sources"}`;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" title={tip}>
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

/** Faithfulness badge — result of the opt-in verify pass against cited sources. */
function VerificationBadge({ verification }: { verification: Verification }) {
  const base = "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide";
  if (verification === "loading") {
    return (
      <span className={cn(base, "text-muted-foreground")}>
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Verifying
      </span>
    );
  }
  const { verdict, issues } = verification;
  if (verdict === "supported") {
    return (
      <span className={cn(base, "text-brand")} title="Every claim is supported by the cited sources">
        <ShieldCheck className="h-3 w-3" /> Verified
      </span>
    );
  }
  if (verdict === "unknown") {
    return (
      <span className={cn(base, "text-muted-foreground")} title="Couldn't verify this answer against sources">
        <ShieldAlert className="h-3 w-3" /> Unverified
      </span>
    );
  }
  const tip = issues.length ? issues.join("\n• ") : "Some claims go beyond the cited sources";
  return (
    <span
      className={cn(base, verdict === "unsupported" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}
      title={`• ${tip}`}
    >
      <ShieldAlert className="h-3 w-3" /> {verdict === "unsupported" ? "Unsupported" : "Partly supported"}
      {issues.length > 0 && <span className="tabular-nums">· {issues.length}</span>}
    </span>
  );
}

/** Per-message action row: copy, save as note, save as flashcard, feedback. */
function MessageActions({ message, question }: { message: Message; question?: string }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [carding, setCarding] = useState(false);
  const [carded, setCarded] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  async function saveAsCard() {
    if (carding || carded || !question) return;
    setCarding(true);
    try {
      const res = await createFlashcardAction({
        question: question.slice(0, 300),
        answer: answerToMarkdown(message).slice(0, 2000),
      });
      if (res.ok) {
        setCarded(true);
        toast.success("Flashcard added to your review deck");
      } else {
        toast.error(res.error ?? "Couldn't create flashcard");
      }
    } catch {
      toast.error("Couldn't create flashcard");
    } finally {
      setCarding(false);
    }
  }

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
      {question && (
        <button
          onClick={saveAsCard}
          disabled={carding || carded}
          title="Turn this Q&A into a flashcard (your question = the front)"
          className={ACTION_BTN}
        >
          {carding ? <Loader2 className="h-3 w-3 animate-spin" /> : carded ? <Check className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
          {carded ? "Card added" : "Make flashcard"}
        </button>
      )}
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
  question,
  onOpenSource,
  onOpenPath,
  onFollowup,
}: {
  message: Message;
  question?: string;
  onOpenSource: (directoryItemId: string) => void;
  onOpenPath: (path: string) => void;
  onFollowup: (question: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand/10 px-4 py-2.5 text-[14.5px] leading-snug">
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
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--brand))" }} /> Answer
        </div>
        <div className="flex items-center gap-3">
          {message.verification && <VerificationBadge verification={message.verification} />}
          {message.content && <GroundingMeter message={message} />}
        </div>
      </div>
      <div className="prose-reader max-w-none text-[15px] leading-[1.7]">
        {message.content ? (
          <CitedMarkdown
            citations={(message.sources ?? []).map((s) => ({
              n: s.n,
              href: `/directory?item=${s.directoryItemId}`,
              title: s.title,
            }))}
            onNavigate={onOpenPath}
          >
            {message.content}
          </CitedMarkdown>
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
            ({message.usage.promptTokens.toLocaleString()} in · {message.usage.completionTokens.toLocaleString()} out)
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
            <SourceRow key={s.url} icon={<Globe className="h-3 w-3 shrink-0 text-muted-foreground" />} title={s.title} href={s.url} />
          ))}
        </div>
      )}
      {message.content && <MessageActions message={message} question={question} />}
      {message.followups && message.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {message.followups.map((f) => (
            <button
              key={f}
              onClick={() => onFollowup(f)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-left text-[12.5px] text-foreground/85 transition-colors hover:border-brand/40 hover:bg-accent"
            >
              <CornerDownRight className="h-3 w-3 shrink-0" style={{ color: "hsl(var(--brand))" }} />
              {f}
            </button>
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

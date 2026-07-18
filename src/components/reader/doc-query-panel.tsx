"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { GraduationCap, Globe, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { ASK_MODEL_KEY, getScopedItem } from "@/lib/settings";
import { usePromptText } from "@/components/ui/app-dialogs";
import { USAGE_SENTINEL, WEBSOURCES_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import {
  loadDocPrompts,
  saveDocPrompts,
  newPromptId,
  type DocPrompt,
} from "@/lib/ai/doc-prompts";


type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };
type WebSource = { title: string; url: string };

function getModel(): string {
  return getScopedItem(ASK_MODEL_KEY) || DEFAULT_CHAT_MODEL;
}

/** Strip HTML tags + collapse whitespace so article HTML becomes plain text. */
function toPlainText(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Per-document "Ask about this" panel. Queries Claude scoped to the open
 * document only, with reusable saved prompts (Inoreader-style). Used by both
 * the feeds article reader and the directory item viewer.
 *
 * Renders as a right-side drawer (full-width on mobile, ~420px on desktop) so
 * it sits beside the reading content instead of pushing it. No desktop scrim —
 * the document stays readable while you ask.
 */
export function DocQueryPanel({
  open,
  title,
  content,
  docId,
  onClose,
}: {
  open: boolean;
  title: string;
  content: string;
  /** Stable identity of the open doc. Changing it resets the panel (so doc B
   *  doesn't show doc A's answer). NOT `content`, which changes on every
   *  keystroke while editing a note. */
  docId?: string;
  onClose: () => void;
}) {
  const promptText = usePromptText();
  const [prompts, setPrompts] = useState<DocPrompt[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [web, setWeb] = useState(false);
  const [socratic, setSocratic] = useState(false);
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPrompts(loadDocPrompts());
  }, []);

  // Drop any in-flight request if the panel unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Reset all answer state when the underlying document changes — otherwise
  // opening doc B shows doc A's answer/transcript until you ask again.
  useEffect(() => {
    abortRef.current?.abort();
    setAnswer("");
    setUsage(null);
    setWebSources([]);
    setTurns([]);
    setSocratic(false);
    setQuestion("");
    setStreaming(false);
  }, [docId]);

  // Esc closes the drawer, matching every other overlay (Dialog, command palette).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || streaming) return;

    const plain = toPlainText(content);
    if (!plain) {
      toast.error("No readable text in this document yet.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setAnswer("");
    setUsage(null);
    setWebSources([]);

    try {
      const res = await fetch("/api/ask-document", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content: plain, question: text, model: getModel(), web }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        toast.error(msg || `Request failed (${res.status})`);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAnswer(displayText(acc));
      }

      // Parse the trailing sentinels: web sources (cited URLs) + token usage.
      const wIdx = acc.indexOf(WEBSOURCES_SENTINEL);
      const uIdx = acc.indexOf(USAGE_SENTINEL);
      if (wIdx >= 0) {
        const end = uIdx > wIdx ? uIdx : acc.length;
        try {
          setWebSources(JSON.parse(acc.slice(wIdx + WEBSOURCES_SENTINEL.length, end)) as WebSource[]);
        } catch {
          /* ignore */
        }
      }
      if (uIdx >= 0) {
        try {
          setUsage(JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Request failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  // Socratic tutor: multi-turn quiz scoped to this document. Sends prior turns
  // as history; the doc lives server-side in the system prompt (sent once).
  async function runSocratic(text: string) {
    if (streaming) return;
    const plain = toPlainText(content);
    if (!plain) {
      toast.error("No readable text in this document yet.");
      return;
    }
    const history = turns;
    setTurns((t) => [...t, { role: "user", content: text || "Begin." }, { role: "assistant", content: "" }]);
    setQuestion("");
    setStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ask-document", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          content: plain,
          question: text,
          model: getModel(),
          mode: "socratic",
          history,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        toast.error(msg || `Request failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const display = displayText(acc);
        setTurns((t) => {
          const next = [...t];
          next[next.length - 1] = { role: "assistant", content: display };
          return next;
        });
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Request failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  function toggleSocratic() {
    const next = !socratic;
    setSocratic(next);
    if (next) {
      setTurns([]);
      void runSocratic(""); // open with the first question
    }
  }

  function send() {
    if (socratic) void runSocratic(question);
    else void ask(question);
  }

  async function addPrompt() {
    const label = (await promptText({ title: "New saved prompt", placeholder: "Prompt name (e.g. Tweet thread)" }))?.trim();
    if (!label) return;
    const body = (
      await promptText({
        title: "Prompt instruction",
        description: "The instruction sent to Claude about this document.",
        placeholder: "e.g. Summarise this as a tweet thread",
      })
    )?.trim();
    if (!body) return;
    const next = [...prompts, { id: newPromptId(), label, prompt: body }];
    setPrompts(next);
    saveDocPrompts(next);
  }

  function deletePrompt(id: string) {
    const next = prompts.filter((p) => p.id !== id);
    setPrompts(next);
    saveDocPrompts(next);
  }

  return (
    <>
      {/* Mobile-only scrim. Desktop has none so the document stays interactive. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity sm:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "not-prose fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-xl transition-transform duration-200 sm:w-[420px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
        // While closed the drawer is off-screen but still in the DOM — inert
        // pulls its textarea/buttons out of the tab order and blocks pointer
        // events, so keyboard users don't Tab into an invisible panel.
        inert={!open}
      >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Ask about this document</span>
        <button
          onClick={() => setWeb((w) => !w)}
          title={web ? "Web search on — Claude may search the web" : "Web search off"}
          className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
            web
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="h-3 w-3" /> Web
        </button>
        <button
          onClick={toggleSocratic}
          disabled={streaming}
          title="Socratic mode — Claude quizzes you on this document"
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
            socratic
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <GraduationCap className="h-3 w-3" /> Quiz
        </button>
        {!socratic && (
          <button
            onClick={() => setManaging((m) => !m)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {managing ? "Done" : "Manage prompts"}
          </button>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Saved prompt presets (hidden in quiz mode) */}
        {!socratic && (
        <div className="flex flex-wrap gap-1.5">
          {prompts.map((p) => (
            <span key={p.id} className="inline-flex items-center">
              <button
                onClick={() => ask(p.prompt)}
                disabled={streaming}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                title={p.prompt}
              >
                {p.label}
              </button>
              {managing && (
                <button
                  onClick={() => deletePrompt(p.id)}
                  className="-ml-1 rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  title="Delete prompt"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {managing && (
            <button
              onClick={addPrompt}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add prompt
            </button>
          )}
        </div>
        )}

        {/* Socratic transcript */}
        {socratic && turns.length > 0 && (
          <div className="space-y-2">
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md p-2.5 text-sm",
                  t.role === "user" ? "ml-6 bg-accent" : "mr-2 border border-border bg-background",
                )}
              >
                {t.role === "assistant" ? (
                  <div className="prose-reader prose-sm max-w-none">
                    {t.content ? (
                      <Markdown>{t.content}</Markdown>
                    ) : (
                      <span className="text-muted-foreground">Thinking…</span>
                    )}
                  </div>
                ) : (
                  t.content
                )}
              </div>
            ))}
          </div>
        )}

        {/* Free-form question / answer input */}
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              socratic
                ? "Type your answer… (⌘/Ctrl+Enter)"
                : "Ask anything about this document… (⌘/Ctrl+Enter)"
            }
            className="min-h-[2.5rem] flex-1 resize-none text-sm"
            rows={2}
          />
          <Button size="icon" onClick={send} disabled={streaming || !question.trim()} title="Send question">
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* Answer (Q&A mode only) */}
        {!socratic && (answer || streaming) && (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="prose-reader prose-sm max-w-none text-sm">
              {answer ? (
                <Markdown>{answer}</Markdown>
              ) : (
                <span className="text-muted-foreground">Thinking…</span>
              )}
            </div>
            {webSources.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Globe className="h-3 w-3" /> Web sources
                </div>
                <ul className="space-y-0.5">
                  {webSources.map((s) => (
                    <li key={s.url} className="truncate text-xs">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 hover:opacity-80"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {usage && (
              <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {usage.totalTokens.toLocaleString()} tokens
              </div>
            )}
          </div>
        )}
      </div>
      </aside>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import {
  loadDocPrompts,
  saveDocPrompts,
  newPromptId,
  type DocPrompt,
} from "@/lib/ai/doc-prompts";

const MODEL_STORAGE_KEY = "ask.model.v1";
const USAGE_SENTINEL = "<<<SB_USAGE:";

type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };

function getModel(): string {
  if (typeof window === "undefined") return DEFAULT_CHAT_MODEL;
  return window.localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_CHAT_MODEL;
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
 */
export function DocQueryPanel({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  const [prompts, setPrompts] = useState<DocPrompt[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPrompts(loadDocPrompts());
  }, []);

  // Drop any in-flight request if the panel unmounts or the doc changes.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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

    try {
      const res = await fetch("/api/ask-document", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content: plain, question: text, model: getModel() }),
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
        const idx = acc.indexOf(USAGE_SENTINEL);
        setAnswer(idx >= 0 ? acc.slice(0, idx) : acc);
      }
      const idx = acc.indexOf(USAGE_SENTINEL);
      if (idx >= 0) {
        try {
          setUsage(JSON.parse(acc.slice(idx + USAGE_SENTINEL.length)) as Usage);
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

  function addPrompt() {
    const label = window.prompt("Prompt name (e.g. 'Tweet thread')")?.trim();
    if (!label) return;
    const body = window.prompt("The instruction sent to Claude about this document:")?.trim();
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
    <div className="not-prose mt-8 rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Ask about this document</span>
        <button
          onClick={() => setManaging((m) => !m)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          {managing ? "Done" : "Manage prompts"}
        </button>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-3">
        {/* Saved prompt presets */}
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

        {/* Free-form question */}
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                ask(question);
              }
            }}
            placeholder="Ask anything about this document… (⌘/Ctrl+Enter)"
            className="min-h-[2.5rem] flex-1 resize-none text-sm"
            rows={2}
          />
          <Button size="icon" onClick={() => ask(question)} disabled={streaming || !question.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* Answer */}
        {(answer || streaming) && (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="prose-reader prose-sm max-w-none text-sm">
              {answer ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
              ) : (
                <span className="text-muted-foreground">Thinking…</span>
              )}
            </div>
            {usage && (
              <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {usage.totalTokens.toLocaleString()} tokens
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

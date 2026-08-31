"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";

/**
 * "What does this mean?" for the passage the reader just selected.
 *
 * ## Why it starts without being asked
 *
 * Selecting the passage IS the question. The reader's actual state of mind is
 * "wait, who is this again" — making them then type something turns a two
 * second recovery into a task, and most people would just read on confused. So
 * the explanation begins streaming the moment the panel opens, and the input
 * below it is for the follow-up, not the opener.
 *
 * ## Why it streams into a side panel
 *
 * A popover over the text would cover the very sentence being explained, and
 * would have nowhere to put an answer longer than a line. The panel sits beside
 * the page, so the reader can read the explanation against the passage — and
 * the passage is repeated at the top of it, because by the time the answer
 * arrives the selection highlight is often scrolled or paged away.
 */
export function BookExplainPanel({
  documentId,
  chapterIdx,
  passage,
}: {
  documentId: string;
  chapterIdx: number;
  passage: string;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (followUp?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setBusy(true);
      setError(null);
      setAnswer("");
      setAsked(followUp ?? null);

      try {
        const res = await fetch(`/api/book/${documentId}/explain`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterIdx, text: passage, question: followUp ?? "" }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setError((await res.text()) || "Couldn't explain that passage.");
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setAnswer((prev) => prev + chunk);
        }
      } catch (err) {
        // An abort is this component asking for a different answer, not a
        // failure — leaving an error on screen for it would be a lie.
        if ((err as Error)?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Couldn't explain that passage.");
        }
      } finally {
        if (abortRef.current === controller) setBusy(false);
      }
    },
    [documentId, chapterIdx, passage],
  );

  // A new selection replaces whatever was being explained, mid-stream included.
  useEffect(() => {
    void run();
    return () => abortRef.current?.abort();
  }, [run]);

  // Follow the stream, but only while the reader is already at the bottom —
  // yanking the panel down while they are re-reading the first paragraph is
  // worse than letting the text run on below the fold.
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [answer]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3">
        <blockquote className="max-h-24 overflow-y-auto border-l-2 border-foreground/25 pl-2.5 text-[13px] italic leading-snug text-muted-foreground">
          {passage}
        </blockquote>
      </div>

      <div ref={answerRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {asked && <p className="mb-2 text-xs font-medium text-muted-foreground">You asked: {asked}</p>}

        {error ? (
          <div className="space-y-3">
            <p className="text-[13px] text-destructive">{error}</p>
            <button
              onClick={() => void run(asked ?? undefined)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              <RefreshCw className="h-3 w-3" /> Try again
            </button>
          </div>
        ) : answer ? (
          <div className="prose-sm max-w-none text-[13px] leading-relaxed">
            <Markdown>{answer}</Markdown>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading it back…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = question.trim();
          if (!q || busy) return;
          setQuestion("");
          void run(q);
        }}
        className="border-t border-border p-2"
      >
        <div className="flex items-center gap-1.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this passage…"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/40"
          />
          <button
            type="submit"
            disabled={busy || question.trim().length === 0}
            aria-label="Ask"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-muted-foreground">
          Only uses this chapter and the ones before it — it can&rsquo;t spoil what you haven&rsquo;t read.
        </p>
      </form>
    </div>
  );
}

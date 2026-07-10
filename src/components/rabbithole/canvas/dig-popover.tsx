"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Rabbit, Send } from "lucide-react";
import { RABBITHOLE_LENSES, type RabbitholeLens } from "@/lib/rabbithole/lenses";

/** Where a dig was requested from: the selected text and the parent node
 *  (null = the selection was in the root document). x/y are viewport coords for
 *  the fixed-position variant; the canvas variant positions via `style`. */
export type DigTarget = {
  text: string;
  parentId: string | null;
  x: number;
  y: number;
};

/**
 * The floating "dig into …" popover: lens chips plus a free-text question.
 * Shared by the reader drawer, the split-view panel, and the canvas.
 */
export function DigPopover({
  target,
  onSubmit,
  style,
}: {
  target: DigTarget;
  onSubmit: (target: DigTarget, lens: RabbitholeLens | null, question: string) => void;
  style?: React.CSSProperties;
}) {
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuestion("");
    inputRef.current?.focus();
  }, [target]);

  const submit = (lens: RabbitholeLens | null) => {
    const q = question.trim();
    if (!lens && !q) return;
    onSubmit(target, lens, q);
  };

  return (
    <div
      data-dig-popover
      className="z-[60] w-[340px] -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-lg"
      style={style}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Rabbit className="h-3.5 w-3.5" />
        Dig into &ldquo;{target.text.length > 40 ? `${target.text.slice(0, 40)}…` : target.text}&rdquo;
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {RABBITHOLE_LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => submit(l.key)}
            className="rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
            title={l.prompt}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(null);
            }
          }}
          placeholder="Or ask your own question…"
          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          onClick={() => submit(null)}
          disabled={!question.trim()}
          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Ask"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

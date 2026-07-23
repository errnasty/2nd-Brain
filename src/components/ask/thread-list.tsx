"use client";

import { useState } from "react";
import { Check, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ThreadSummary } from "@/app/(app)/ask/thread-actions";

/**
 * Conversation list — the provider-style thread rail. Rendered in the desktop
 * sidebar and (same component) inside the mobile drawer. Pure presentation:
 * the shell owns thread data + persistence and passes callbacks.
 */
export function ThreadList({
  threads,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = query.trim()
    ? threads.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
    : threads;

  function startRename(t: ThreadSummary) {
    setEditingId(t.id);
    setDraft(t.title);
  }
  function commitRename() {
    if (editingId) {
      const clean = draft.trim();
      if (clean) onRename(editingId, clean);
    }
    setEditingId(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Plus className="h-4 w-4" style={{ color: "hsl(var(--brand))" }} />
          New chat
        </button>
      </div>
      {threads.length > 6 && (
        <div className="px-2 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {threads.length === 0 ? "No conversations yet." : "No matches."}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((t) => {
              const active = t.id === activeId;
              if (editingId === t.id) {
                return (
                  <div key={t.id} className="flex items-center gap-1 px-1 py-0.5">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <button onClick={commitRename} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Save">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={t.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-1 transition-colors",
                    active ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <button
                    onClick={() => onSelect(t.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                    title={t.title}
                  >
                    <MessageSquare
                      className={cn("h-3.5 w-3.5 shrink-0", active ? "text-brand" : "text-muted-foreground")}
                    />
                    <span className="truncate text-sm">{t.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                        title="More"
                        aria-label={`Options for ${t.title}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem onClick={() => startRename(t)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(t.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

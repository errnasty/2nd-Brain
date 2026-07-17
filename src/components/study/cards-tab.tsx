"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Layers, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  deleteFlashcardsAction,
  fetchAllCardsAction,
  updateFlashcardAction,
  type CardRow,
} from "@/app/(app)/study/card-actions";
import { formatRelativeTime } from "@/lib/utils";

const PAGE_SIZE = 50;

/**
 * Browse every flashcard (not just due ones), search across question/answer/
 * source title, edit a card's wording in place, delete with an undo window,
 * and export the whole deck as CSV. There was previously no way to see or fix
 * an individual card outside the review flow.
 */
export function CardsTab() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");

  // Deferred-delete-with-undo: hide the row immediately, commit the real
  // delete after 6s unless Undo cancels it (same pattern as the Directory).
  const [pendingRemovedIds, setPendingRemovedIds] = useState<Set<string>>(new Set());
  const pendingDeletes = useRef<Map<string, number>>(new Map());
  useEffect(
    () => () => {
      // Flush any still-pending deletes on unmount rather than silently drop them.
      pendingDeletes.current.forEach((_timer, id) => void deleteFlashcardsAction([id]));
      pendingDeletes.current.clear();
    },
    [],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  function load(q: string, offset: number, append: boolean) {
    if (append) setLoadingMore(true);
    fetchAllCardsAction({ q, offset, limit: PAGE_SIZE })
      .then((r) => {
        setCards((prev) => (append && prev ? [...prev, ...r.cards] : r.cards));
        setHasMore(r.hasMore);
      })
      .catch(() => toast.error("Couldn't load flashcards"))
      .finally(() => setLoadingMore(false));
  }

  // Initial load, and a debounced reload whenever the search query changes.
  useEffect(() => {
    const handle = setTimeout(
      () => {
        setCards(null);
        load(query, 0, false);
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(handle);
  }, [query]);

  function loadMore() {
    if (loadingMore || !hasMore || !cards) return;
    load(query, cards.length, true);
  }

  function deleteWithUndo(id: string) {
    setPendingRemovedIds((prev) => new Set(prev).add(id));
    setEditingId((e) => (e === id ? null : e));
    const commit = () => {
      pendingDeletes.current.delete(id);
      void deleteFlashcardsAction([id]);
    };
    const undo = () => {
      const timer = pendingDeletes.current.get(id);
      if (timer) clearTimeout(timer);
      pendingDeletes.current.delete(id);
      setPendingRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
    const timer = window.setTimeout(commit, 6000);
    pendingDeletes.current.set(id, timer);
    toast("Card deleted", { action: { label: "Undo", onClick: undo }, duration: 6000 });
  }

  function startEdit(card: CardRow) {
    setEditingId(card.id);
    setEditQuestion(card.question);
    setEditAnswer(card.answer);
  }

  function saveEdit(id: string) {
    const question = editQuestion.trim();
    const answer = editAnswer.trim();
    if (question.length < 3 || answer.length < 1) {
      toast.error("Question or answer is too short");
      return;
    }
    setSavingEdit(true);
    updateFlashcardAction({ id, question, answer })
      .then((r) => {
        if (r.ok) {
          setCards((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, question, answer } : c)) : prev));
          setEditingId(null);
        } else {
          toast.error(r.error);
        }
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't save this card"))
      .finally(() => setSavingEdit(false));
  }

  const visible = cards?.filter((c) => !pendingRemovedIds.has(c.id)) ?? null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="editorial-eyebrow mb-1">Study · Cards</div>
          <h1 className="editorial-display m-0 flex items-center gap-2" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
            <Layers className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--brand))" }} /> Cards
          </h1>
        </div>
        <Button variant="outline" asChild className="gap-1.5">
          <a href="/api/export/flashcards" download>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search question, answer, or document…"
          className="pl-8"
        />
      </div>

      {visible === null ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your deck…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/40" />
          <p className="max-w-sm text-sm italic text-muted-foreground">
            {query ? "No cards match that search." : "No flashcards yet — make some from a document in the Directory."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => {
            const editing = editingId === c.id;
            return (
              <li key={c.id} className="rounded-lg border border-border bg-card px-4 py-3">
                {editing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      placeholder="Question"
                      className="min-h-[3rem] text-sm"
                      autoFocus
                    />
                    <Textarea
                      value={editAnswer}
                      onChange={(e) => setEditAnswer(e.target.value)}
                      placeholder="Answer"
                      className="min-h-[4rem] text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={savingEdit}>
                        <X className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(c.id)} disabled={savingEdit}>
                        {savingEdit ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.question}</div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{c.answer}</div>
                      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {c.itemTitle ?? "General"} · due {formatRelativeTime(c.dueDate)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(c)} title="Edit card">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => deleteWithUndo(c.id)}
                        title="Delete card"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-1.5">
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Newspaper, NotebookPen, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  fetchQuizItemOptionsAction,
  generateQuizAction,
  type QuizItemOption,
} from "@/app/(app)/study/quiz-actions";

const KIND_ICON: Record<string, React.ReactNode> = {
  saved_article: <Newspaper className="h-3.5 w-3.5 text-muted-foreground" />,
  uploaded_document: <FileText className="h-3.5 w-3.5 text-muted-foreground" />,
  user_note: <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />,
};

/**
 * Pick one or more Directory documents to build a quiz from. The Study hub's
 * "New quiz" entry point — the bulk-select-in-Directory flow covers the same
 * job when you already know which items you want.
 */
export function QuizPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<QuizItemOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(new Set());
    if (items === null) {
      void fetchQuizItemOptionsAction().then(setItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items) return [];
    if (!q) return items;
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, query]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function create() {
    if (selected.size === 0 || creating) return;
    setCreating(true);
    generateQuizAction(Array.from(selected))
      .then((r) => {
        if (r.ok) {
          toast.success(`Quiz ready — ${r.count} question${r.count === 1 ? "" : "s"}`);
          onOpenChange(false);
          router.push(`/study?tab=quiz&quiz=${r.id}`);
          router.refresh();
        } else {
          toast.error(r.error);
        }
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't create the quiz"))
      .finally(() => setCreating(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New quiz</DialogTitle>
          <DialogDescription>
            Pick one or more documents — the quiz mixes multiple-choice and open-ended
            questions across all of them.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your documents…"
            className="pl-8"
          />
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
          {items === null ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your library…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm italic text-muted-foreground">
              {query ? "No matches." : "Nothing in your Directory yet."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((i) => (
                <li key={i.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent/50">
                    <Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
                    {KIND_ICON[i.kind]}
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={create} disabled={selected.size === 0 || creating} className="gap-1.5">
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create quiz
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, GitMerge, Hash, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  bulkDeleteTagsAction,
  deleteTagAction,
  mergeTagsAction,
  renameTagAction,
} from "@/app/(app)/tags/actions";
import { useConfirm } from "@/components/ui/app-dialogs";
import { toast } from "sonner";
import type { Tag } from "@/lib/db/schema";

type Usage = { total: number; article: number; document: number; directoryItem: number };

export function TagManager({
  tags,
  usage,
}: {
  tags: Tag[];
  usage: Record<string, Usage>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      const valid = new Set(tags.map((t) => t.id));
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next;
    });
  }, [tags]);

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === tags.length) setChecked(new Set());
    else setChecked(new Set(tags.map((t) => t.id)));
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditValue(tag.name);
  }

  function commitEdit() {
    if (!editingId) return;
    const id = editingId;
    const name = editValue.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    setEditingId(null);
    startTransition(async () => {
      const r = await renameTagAction({ id, name });
      if (!r.ok) toast.error(r.error);
      else toast.success("Tag renamed");
    });
  }

  async function handleDelete(tag: Tag) {
    const count = usage[tag.id]?.total ?? 0;
    const ok = await confirm({
      title: `Delete "${tag.name}"?`,
      body:
        count > 0
          ? `This unlinks it from ${count} item${count === 1 ? "" : "s"} (the items themselves are kept).`
          : undefined,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteTagAction(tag.id);
        toast.success("Tag deleted");
      } catch (e) {
        toast.error(`Delete failed: ${e instanceof Error ? e.message : "error"}`);
      }
    });
  }

  async function handleMerge() {
    const ids = Array.from(checked);
    if (ids.length < 2) return;
    const selectedTags = tags.filter((t) => ids.includes(t.id));
    const target = [...selectedTags].sort(
      (a, b) => (usage[b.id]?.total ?? 0) - (usage[a.id]?.total ?? 0),
    )[0];
    const sources = ids.filter((id) => id !== target.id);
    const ok = await confirm({
      title: `Merge ${sources.length} tag${sources.length === 1 ? "" : "s"} into "${target.name}"?`,
      body: `Items keep their links under "${target.name}"; the others are deleted.`,
      confirmLabel: "Merge",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await mergeTagsAction({ targetId: target.id, sourceIds: sources });
      if (r.ok) {
        toast.success(`Merged into "${target.name}"`);
        setChecked(new Set());
      } else {
        toast.error(r.error);
      }
    });
  }

  async function handleBulkDelete() {
    const ids = Array.from(checked);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.length} tag${ids.length === 1 ? "" : "s"}?`,
      body: "Links to items will be removed; the items themselves are kept.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await bulkDeleteTagsAction(ids);
        if (r.ok) {
          toast.success(`Deleted ${r.count} tag${r.count === 1 ? "" : "s"}`);
          setChecked(new Set());
        } else {
          toast.error("Couldn't delete the selected tags.");
        }
      } catch (e) {
        toast.error(`Delete failed: ${e instanceof Error ? e.message : "error"}`);
      }
    });
  }

  function openInDirectory(tag: Tag) {
    router.push(`/directory?tags=${tag.id}`);
  }

  if (tags.length === 0) return null;

  const allChecked = checked.size === tags.length;
  const someChecked = checked.size > 0 && !allChecked;
  const maxTotal = Math.max(1, ...tags.map((t) => usage[t.id]?.total ?? 0));

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 w-10">
                <Checkbox
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all tags"
                />
              </th>
              <th className="px-4 py-2.5 font-semibold">Tag</th>
              <th className="px-4 py-2.5 font-semibold">Used by</th>
              <th className="px-4 py-2.5 font-semibold">Distribution</th>
              <th className="px-4 py-2.5 font-semibold">Breakdown</th>
              <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tags.map((tag) => {
              const u = usage[tag.id] ?? { total: 0, article: 0, document: 0, directoryItem: 0 };
              const isChecked = checked.has(tag.id);
              const pct = Math.round((u.total / maxTotal) * 100);
              return (
                <tr key={tag.id} className="hover:bg-accent/30">
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleChecked(tag.id)}
                      aria-label={`Select ${tag.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {editingId === tag.id ? (
                      <div className="flex items-center gap-2">
                        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-7 text-sm"
                        />
                        <button
                          onClick={commitEdit}
                          className="rounded p-1 text-green-600 hover:bg-accent"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openInDirectory(tag)}
                        className="inline-flex items-center gap-1.5 font-mono text-[12.5px] hover:underline"
                        style={{ color: "hsl(var(--brand))" }}
                        title="Filter Directory by this tag"
                      >
                        <Hash className="h-3.5 w-3.5 opacity-60" />
                        {tag.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{u.total}</td>
                  <td className="w-40 px-4 py-3">
                    {/* Brass distribution bar — at-a-glance tag weight */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          background: "hsl(var(--brand))",
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs italic text-muted-foreground">
                    {[
                      u.directoryItem > 0 ? `${u.directoryItem} dir.` : null,
                      u.article > 0 ? `${u.article} art.` : null,
                      u.document > 0 ? `${u.document} doc.` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId !== tag.id && (
                      <div className="inline-flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => startEdit(tag)}
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(tag)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {checked.size > 0 && (
        <div className="pointer-events-auto fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur md:bottom-6 md:flex-nowrap md:rounded-full">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.08em]">
            {checked.size} selected
          </span>
          <span className="h-4 w-px bg-border" />
          {checked.size > 1 && (
            <Button size="sm" variant="ghost" onClick={handleMerge}>
              <GitMerge className="mr-1.5 h-3.5 w-3.5" />
              Merge
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleBulkDelete}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => setChecked(new Set())}
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

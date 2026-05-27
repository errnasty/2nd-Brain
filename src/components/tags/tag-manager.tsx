"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Hash, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteTagAction, renameTagAction } from "@/app/(app)/tags/actions";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [, startTransition] = useTransition();

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditValue(tag.name);
  }

  function commitEdit() {
    if (!editingId) return;
    const id = editingId;
    const name = editValue.trim();
    setEditingId(null);
    startTransition(async () => {
      const r = await renameTagAction({ id, name });
      if (!r.ok) toast.error(r.error);
      else toast.success("Tag renamed");
    });
  }

  function handleDelete(tag: Tag) {
    const count = usage[tag.id]?.total ?? 0;
    const msg =
      count > 0
        ? `Delete "${tag.name}"? This will unlink it from ${count} item${count === 1 ? "" : "s"} (the items themselves are kept).`
        : `Delete "${tag.name}"?`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      await deleteTagAction(tag.id);
      toast.success("Tag deleted");
    });
  }

  function openInDirectory(tag: Tag) {
    router.push(`/directory?tags=${tag.id}`);
  }

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-semibold">Tag</th>
            <th className="px-4 py-2 font-semibold">Used by</th>
            <th className="px-4 py-2 font-semibold">Breakdown</th>
            <th className="px-4 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tags.map((tag) => {
            const u = usage[tag.id] ?? { total: 0, article: 0, document: 0, directoryItem: 0 };
            return (
              <tr key={tag.id} className="hover:bg-accent/30">
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
                      className="inline-flex items-center gap-1.5 font-medium hover:underline"
                      title="Filter Directory by this tag"
                    >
                      <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                      {tag.name}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{u.total}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {[
                    u.directoryItem > 0 ? `${u.directoryItem} directory` : null,
                    u.article > 0 ? `${u.article} article` : null,
                    u.document > 0 ? `${u.document} document` : null,
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
  );
}

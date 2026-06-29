"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Archive, Check, Copy, GitMerge, Hash, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  bulkDeleteTagsAction,
  deleteTagAction,
  findDuplicateTagsAction,
  mergeTagsAction,
  renameTagAction,
  type DuplicateGroup,
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
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "orphaned">("all");
  const [sortBy, setSortBy] = useState<"usage" | "name" | "recent">("usage");
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [, startTransition] = useTransition();

  // #14 Scan for likely-duplicate tags.
  async function scanDuplicates() {
    if (scanning) return;
    setScanning(true);
    try {
      const groups = await findDuplicateTagsAction();
      setDupGroups(groups);
      if (groups.length === 0) toast.success("No likely duplicates found");
    } catch {
      toast.error("Couldn't scan for duplicates");
    } finally {
      setScanning(false);
    }
  }

  function mergeGroup(group: DuplicateGroup) {
    // Merge into the most-used tag in the group.
    const target = [...group.ids].sort(
      (a, b) => (usage[b]?.total ?? 0) - (usage[a]?.total ?? 0),
    )[0];
    const sources = group.ids.filter((id) => id !== target);
    startTransition(async () => {
      const r = await mergeTagsAction({ targetId: target, sourceIds: sources });
      if (r.ok) {
        toast.success("Tags merged");
        setDupGroups((prev) => prev?.filter((g) => g !== group) ?? null);
      } else {
        toast.error(r.error);
      }
    });
  }

  async function archiveUnderused(ids: string[]) {
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Archive ${ids.length} underused tag${ids.length === 1 ? "" : "s"}?`,
      body: "These have 2 or fewer items. Links are removed; the items themselves are kept.",
      destructive: true,
      confirmLabel: "Archive all",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await bulkDeleteTagsAction(ids);
        if (r.ok) toast.success(`Archived ${r.count} tag${r.count === 1 ? "" : "s"}`);
        else toast.error("Couldn't archive the tags.");
      } catch (e) {
        toast.error(`Archive failed: ${e instanceof Error ? e.message : "error"}`);
      }
    });
  }

  // #16 Search + segmented filter (All/Active/Orphaned) + sort.
  const visibleTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tags.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      const total = usage[t.id]?.total ?? 0;
      if (filterMode === "active") return total > 0;
      if (filterMode === "orphaned") return total === 0;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "recent")
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return (usage[b.id]?.total ?? 0) - (usage[a.id]?.total ?? 0);
    });
  }, [tags, usage, search, filterMode, sortBy]);

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
    const allSel = visibleTags.length > 0 && visibleTags.every((t) => checked.has(t.id));
    if (allSel) setChecked(new Set());
    else setChecked(new Set(visibleTags.map((t) => t.id)));
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

  const allChecked = visibleTags.length > 0 && visibleTags.every((t) => checked.has(t.id));
  const someChecked = checked.size > 0 && !allChecked;
  const maxTotal = Math.max(1, ...tags.map((t) => usage[t.id]?.total ?? 0));
  const activeCount = tags.filter((t) => (usage[t.id]?.total ?? 0) > 0).length;
  const orphanCount = tags.length - activeCount;
  // #15 Underused = 2 or fewer items.
  const underused = tags.filter((t) => (usage[t.id]?.total ?? 0) <= 2);

  return (
    <>
      {/* #14 Likely-duplicate tags */}
      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="editorial-eyebrow-brand inline-flex items-center gap-1.5">
            <Copy className="h-3 w-3" /> § Likely duplicates
          </span>
          <Button size="sm" variant="outline" onClick={scanDuplicates} disabled={scanning} className="h-7 text-xs">
            {scanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {dupGroups ? "Re-scan" : "Scan"}
          </Button>
        </div>
        {dupGroups && dupGroups.length > 0 && (
          <div className="mt-3 space-y-2">
            {dupGroups.map((g, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {g.names.map((n, j) => (
                      <span key={j} className="inline-flex items-center gap-1 font-mono text-[12px]">
                        <Hash className="h-3 w-3 opacity-50" />{n}
                        {j < g.names.length - 1 && <span className="opacity-40">≈</span>}
                      </span>
                    ))}
                  </div>
                  <div className="mt-0.5 text-[11px] italic text-muted-foreground">{g.reason}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mergeGroup(g)}>
                    <GitMerge className="mr-1 h-3.5 w-3.5" /> Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setDupGroups((prev) => prev?.filter((x) => x !== g) ?? null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {dupGroups && dupGroups.length === 0 && (
          <p className="mt-2 text-xs italic text-muted-foreground">No likely duplicates — your taxonomy is tidy.</p>
        )}
      </div>

      {/* #15 Underused tags */}
      {underused.length > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="editorial-eyebrow-brand inline-flex items-center gap-1.5">
              <Archive className="h-3 w-3" /> § Underused · {underused.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => archiveUnderused(underused.map((t) => t.id))}
            >
              <Archive className="mr-1 h-3.5 w-3.5" /> Archive all
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {underused.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                title={`${usage[t.id]?.total ?? 0} item${(usage[t.id]?.total ?? 0) === 1 ? "" : "s"}`}
              >
                <Hash className="h-2.5 w-2.5 opacity-60" />{t.name}
                <span className="opacity-50">· {usage[t.id]?.total ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* #16 Search · segmented filter · sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["all", "active", "orphaned"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={cn(
                "rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
                filterMode === m
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "all" ? "All" : m === "active" ? `Active · ${activeCount}` : `Orphaned · ${orphanCount}`}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "usage" | "name" | "recent")}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none"
          aria-label="Sort tags"
        >
          <option value="usage">Most used</option>
          <option value="name">A–Z</option>
          <option value="recent">Newest</option>
        </select>
      </div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Showing {visibleTags.length} of {tags.length}
      </p>

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
            {visibleTags.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm italic text-muted-foreground">
                  No tags match.
                </td>
              </tr>
            )}
            {visibleTags.map((tag) => {
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

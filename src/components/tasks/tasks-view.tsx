"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { toggleTaskAction, type TaskRow } from "@/app/(app)/tasks/actions";

type Filter = "today" | "open" | "done" | "all";

function startOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Bucket label for an open task by due date relative to now. */
function bucketOf(due: Date | null): "Overdue" | "Today" | "Upcoming" | "No date" {
  if (!due) return "No date";
  const end = startOfToday();
  const t = new Date(due).getTime();
  if (t < new Date().setHours(0, 0, 0, 0)) return "Overdue";
  if (t <= end) return "Today";
  return "Upcoming";
}

const BUCKET_ORDER = ["Overdue", "Today", "Upcoming", "No date"] as const;

export function TasksView({ tasks }: { tasks: TaskRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const [, startTransition] = useTransition();
  // Optimistic done overrides so the checkbox flips instantly.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const withDone = useMemo(
    () => tasks.map((t) => ({ ...t, done: overrides[t.id] ?? t.done })),
    [tasks, overrides],
  );

  const visible = useMemo(() => {
    if (filter === "all") return withDone;
    if (filter === "done") return withDone.filter((t) => t.done);
    if (filter === "today")
      return withDone.filter((t) => !t.done && bucketOf(t.dueDate) !== "Upcoming" && t.dueDate);
    return withDone.filter((t) => !t.done); // "open"
  }, [withDone, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const t of visible) {
      const key = filter === "done" ? "Done" : bucketOf(t.dueDate);
      (m.get(key) ?? m.set(key, []).get(key)!).push(t);
    }
    return m;
  }, [visible, filter]);

  function toggle(t: (typeof withDone)[number]) {
    const next = !t.done;
    setOverrides((o) => ({ ...o, [t.id]: next }));
    startTransition(async () => {
      const r = await toggleTaskAction({ id: t.id, done: next });
      if (!r.ok) {
        setOverrides((o) => ({ ...o, [t.id]: t.done }));
        toast.error(r.error);
      } else {
        router.refresh();
      }
    });
  }

  const openCount = withDone.filter((t) => !t.done).length;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CheckSquare className="h-5 w-5" /> Tasks
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {openCount} open · pulled from checkboxes in your Directory notes
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
          {(["today", "open", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded px-2.5 py-1 capitalize transition-colors",
                filter === f
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Square className="h-8 w-8 opacity-30" />
            <p>
              No tasks here. Add{" "}
              <code className="rounded bg-muted px-1">- [ ] something (due: 2026-06-30)</code> to any
              note.
            </p>
          </div>
        ) : (
          BUCKET_ORDER.concat("Done" as never).map((bucket) => {
            const rows = grouped.get(bucket);
            if (!rows || rows.length === 0) return null;
            return (
              <div key={bucket} className="mb-6">
                <div
                  className={cn(
                    "mb-2 text-[10px] font-semibold uppercase tracking-wider",
                    bucket === "Overdue" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {bucket} · {rows.length}
                </div>
                <ul className="space-y-0.5">
                  {rows.map((t) => (
                    <li
                      key={t.id}
                      className="group flex items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
                    >
                      <div className="mt-0.5">
                        <Checkbox checked={t.done} onCheckedChange={() => toggle(t)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "text-sm leading-snug",
                            t.done && "text-muted-foreground line-through",
                          )}
                        >
                          {t.text}
                        </div>
                        <button
                          onClick={() => router.push(`/directory?item=${t.itemId}`)}
                          className="mt-0.5 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {t.itemTitle}
                          {t.dueDate && (
                            <span className="ml-2">
                              · due {new Date(t.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

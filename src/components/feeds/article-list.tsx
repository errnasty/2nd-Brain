"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, Star } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { setReadStatusAction } from "@/app/(app)/feeds/actions";
import { toast } from "sonner";
import { useShortcuts } from "@/components/reader/use-shortcuts";

export type ArticleListItem = {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  url: string;
  publishDate: Date | null;
  readStatus: "unread" | "read" | "archived";
  starred: boolean;
  imageUrl: string | null;
  feedTitle: string;
  feedIconUrl: string | null;
};

type OptimisticPatch = { id: string; readStatus?: ArticleListItem["readStatus"]; starred?: boolean };

export function ArticleList({
  items,
  selectedId,
  view,
}: {
  items: ArticleListItem[];
  selectedId: string | null;
  view: "unread" | "all" | "starred";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [optimistic, applyOptimistic] = useOptimistic(
    items,
    (state, patch: OptimisticPatch) =>
      state.map((it) => (it.id === patch.id ? { ...it, ...patch } : it)),
  );

  function openArticle(id: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("article", id);
    router.replace(`/feeds?${sp.toString()}`, { scroll: false });
    const target = optimistic.find((i) => i.id === id);
    if (target && target.readStatus !== "read") {
      startTransition(async () => {
        applyOptimistic({ id, readStatus: "read" });
        // Fire-and-forget; no revalidate (the action is optimistic on the server too)
        await setReadStatusAction({ articleIds: [id], status: "read" });
      });
    }
  }

  useShortcuts(
    {
      j: () => {
        if (selectedId) return; // reader-pane handles it when an article is open
        if (optimistic[0]) openArticle(optimistic[0].id);
      },
      k: () => {
        if (selectedId) return;
      },
    },
    !selectedId,
  );

  function markAllRead() {
    const unread = optimistic.filter((i) => i.readStatus === "unread");
    if (unread.length === 0) return;
    startTransition(async () => {
      unread.forEach((i) => applyOptimistic({ id: i.id, readStatus: "read" }));
      const res = await setReadStatusAction({
        articleIds: unread.map((i) => i.id),
        status: "read",
      });
      if (res.ok) toast.success(`Marked ${unread.length} as read`);
    });
  }

  return (
    <section className="hidden w-full max-w-sm shrink-0 flex-col border-r border-border md:flex">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ViewLink view="unread" current={view} label="Unread" />
          <ViewLink view="all" current={view} label="All" />
          <ViewLink view="starred" current={view} label="Starred" />
        </div>
        <Button size="sm" variant="ghost" onClick={markAllRead} title="Mark all as read">
          <CheckCheck className="h-4 w-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        {optimistic.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No articles. Try syncing your feeds.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {optimistic.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => openArticle(item.id)}
                  className={cn(
                    "block w-full px-3 py-3 text-left transition-colors",
                    selectedId === item.id ? "bg-accent" : "hover:bg-accent/60",
                    item.readStatus === "read" && "opacity-60",
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {item.feedIconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.feedIconUrl} alt="" className="h-3 w-3 rounded-sm" />
                    ) : null}
                    <span className="truncate">{item.feedTitle}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(item.publishDate)}</span>
                    {item.starred && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                  </div>
                  <div
                    className={cn(
                      "text-sm leading-snug",
                      item.readStatus === "unread" ? "font-semibold" : "font-normal",
                    )}
                  >
                    {item.title}
                  </div>
                  {item.excerpt && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.excerpt}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}

function ViewLink({
  view,
  current,
  label,
}: {
  view: "unread" | "all" | "starred";
  current: "unread" | "all" | "starred";
  label: string;
}) {
  const params = useSearchParams();
  const sp = new URLSearchParams(params.toString());
  sp.set("view", view);
  sp.delete("article");
  return (
    <Link
      href={`/feeds?${sp.toString()}`}
      className={cn(
        "rounded-md px-2 py-1 text-xs",
        view === current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

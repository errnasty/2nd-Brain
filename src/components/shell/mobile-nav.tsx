"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  FolderClosed,
  Inbox,
  Layers,
  Library,
  MessageCircle,
  Rss,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarData } from "@/lib/offline/use-sidebar-data";
import type { CachedFolder } from "@/lib/offline/db";

const TABS = [
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/directory", label: "Directory", icon: Library },
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/tags", label: "Tags", icon: Tag },
];

/**
 * Mobile-only (<768px) bottom navigation + slide-out folder drawer.
 * The drawer's folder tree is offline-first: it paints from the IndexedDB
 * mirror immediately and reconciles with the server in the background.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-card/95 backdrop-blur md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground"
          aria-label="Browse folders"
        >
          <Layers className="h-5 w-5" />
          <span className="text-[10px]">Browse</span>
        </button>
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{label}</span>
            </Link>
          );
        })}
      </nav>

      <FolderDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

function buildTree(folders: CachedFolder[]) {
  const byParent = new Map<string | null, CachedFolder[]>();
  for (const f of folders.filter((x) => !x.isInbox)) {
    const key = f.parentId ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(f);
  }
  return byParent;
}

function FolderDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { folders, tags, syncing } = useSidebarData();
  const byParent = buildTree(folders);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return null;
    return (
      <ul className={cn(depth > 0 && "ml-3 border-l border-border/50 pl-2")}>
        {children.map((f) => (
          <li key={f.id}>
            <button
              onClick={() => go(`/directory?folder=${f.id}`)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
            >
              <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{f.name}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </button>
            {renderLevel(f.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {/* Scrim */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      {/* Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Browse</span>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => go("/directory?folder=unsorted")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
          >
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <span>Unsorted</span>
          </button>
          <button
            onClick={() => go("/directory")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
          >
            <Library className="h-4 w-4 text-muted-foreground" />
            <span>All items</span>
          </button>

          <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            Folders {syncing && <span className="ml-1 normal-case opacity-60">· syncing…</span>}
          </div>
          {folders.filter((f) => !f.isInbox).length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No folders yet.</p>
          ) : (
            renderLevel(null, 0)
          )}

          {tags.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-4 text-[10px] uppercase tracking-wider text-muted-foreground">
                Tags
              </div>
              <div className="flex flex-wrap gap-1 px-2">
                {tags.slice(0, 40).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => go(`/directory?tags=${t.id}`)}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

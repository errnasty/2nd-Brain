"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  FolderClosed,
  GraduationCap,
  Inbox,
  Library,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  NotebookPen,
  Rabbit,
  Rss,
  Search,
  Settings,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useSidebarData } from "@/lib/offline/use-sidebar-data";
import type { CachedFolder } from "@/lib/offline/db";

// Primary top-level destinations (bottom bar, ≤5 incl. the More button).
const TABS = [
  { href: "/today", label: "Today", icon: Sparkles },
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/directory", label: "Directory", icon: Library },
  { href: "/ask", label: "Ask", icon: MessageCircle },
];

// Secondary sections — surfaced through the "More" sheet, not the bottom bar.
const MORE_LINKS = [
  { href: "/map", label: "Knowledge Map", icon: Network },
  { href: "/study", label: "Study", icon: GraduationCap },
  { href: "/rabbithole", label: "Rabbithole", icon: Rabbit },
  { href: "/tags", label: "Tags", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

const TITLES: Record<string, string> = {
  "/today": "Today's Brief",
  "/feeds": "Feeds",
  "/directory": "Directory",
  "/ask": "Ask",
  "/map": "Knowledge Map",
  "/study": "Study",
  "/rabbithole": "Rabbithole",
  "/tags": "Tags",
  "/settings": "Settings",
};

function titleFor(pathname: string): string {
  const hit = Object.keys(TITLES).find((p) => pathname === p || pathname.startsWith(p));
  return hit ? TITLES[hit] : "Second Brain";
}

/**
 * Mobile-only (<768px) chrome: a top app bar (browse drawer · title · search ·
 * theme) and a bottom tab bar with a More overflow sheet. The folder drawer is
 * offline-first — it paints from the IndexedDB mirror, then reconciles.
 */
export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const onMoreRoute = MORE_LINKS.some((l) => pathname.startsWith(l.href));

  // The More-sheet links sit offscreen (translate-y-full) so viewport-based
  // Link prefetch never fires before the sheet opens — too late for an
  // instant tap. Prefetch those routes eagerly instead (full RSC data;
  // router.prefetch defaults to a full prefetch). Deduped by the router
  // cache, so the desktop sidebar doing the same is free.
  useEffect(() => {
    for (const { href } of MORE_LINKS) router.prefetch(href);
  }, [router]);

  return (
    <>
      {/* Top app bar */}
      <header
        className="fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b border-border bg-card/95 px-1.5 backdrop-blur md:hidden"
        style={{ height: "calc(3rem + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Browse folders and tags"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
        <span className="flex-1 truncate px-1 text-sm font-semibold tracking-tight">
          {titleFor(pathname)}
        </span>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture"))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Quick capture a note"
        >
          <NotebookPen className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
        <ThemeToggle />
      </header>

      {/* Bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              // Full prefetch: bottom-bar tabs are always visible, so every
              // primary section is warm before the first tap — no skeleton.
              prefetch={true}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[3rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
                active ? "text-brand" : "text-muted-foreground",
              )}
            >
              {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand" />}
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More sections"
          className={cn(
            "relative flex min-h-[3rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
            onMoreRoute ? "text-brand" : "text-muted-foreground",
          )}
        >
          {onMoreRoute && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand" />}
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px]">More</span>
        </button>
      </nav>

      <FolderDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} activePath={pathname} />
    </>
  );
}

/** Close an overlay on Escape while it's open (parity with Radix Dialog). */
function useEscClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

function MoreSheet({
  open,
  onClose,
  activePath,
}: {
  open: boolean;
  onClose: () => void;
  activePath: string;
}) {
  useEscClose(open, onClose);
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-card transition-transform duration-200 md:hidden",
          open ? "translate-y-0" : "translate-y-full",
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        role="dialog"
        aria-label="More sections"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">More</span>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="px-2 pb-2">
          {MORE_LINKS.map(({ href, label, icon: Icon }) => {
            const active = activePath.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                )}
              >
                <Icon className="h-5 w-5 text-muted-foreground" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
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
  useEscClose(open, onClose);

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
        inert={!open}
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

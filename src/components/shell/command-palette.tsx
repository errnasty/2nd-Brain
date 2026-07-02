"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Brain,
  CheckSquare,
  FileText,
  FolderTree,
  GraduationCap,
  Hash,
  Loader2,
  Network,
  Newspaper,
  NotebookPen,
  Rss,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { globalSearchAction, type GlobalSearchHit } from "@/app/(app)/search-actions";

type NavCommand = { label: string; href: string; icon: React.ReactNode; keywords?: string };
type ActionCommand = { label: string; icon: React.ReactNode; keywords?: string; run: () => void };

// Non-navigation commands (run an action instead of routing). Quick capture is
// the first so a fresh ⌘K → Enter drops you straight into a new note.
const ACTIONS: ActionCommand[] = [
  {
    label: "New note (quick capture)",
    icon: <NotebookPen className="h-4 w-4" />,
    keywords: "capture quick add note new jot",
    run: () => window.dispatchEvent(new CustomEvent("open-quick-capture")),
  },
  {
    label: "Show tutorial",
    icon: <Sparkles className="h-4 w-4" />,
    keywords: "tutorial onboarding tour help guide getting started",
    run: () => window.dispatchEvent(new CustomEvent("open-onboarding")),
  },
];

const NAV: NavCommand[] = [
  { label: "Today's Brief", href: "/today", icon: <Sparkles className="h-4 w-4" />, keywords: "daily brief ai" },
  { label: "Feeds", href: "/feeds", icon: <Rss className="h-4 w-4" />, keywords: "articles rss reader" },
  { label: "Directory", href: "/directory", icon: <FolderTree className="h-4 w-4" />, keywords: "notes docs folders" },
  { label: "Study", href: "/study", icon: <GraduationCap className="h-4 w-4" />, keywords: "learn dashboard stats streak" },
  { label: "Tasks", href: "/study?tab=tasks", icon: <CheckSquare className="h-4 w-4" />, keywords: "todo checkbox due" },
  { label: "Review", href: "/study?tab=review", icon: <Brain className="h-4 w-4" />, keywords: "flashcards spaced repetition srs" },
  { label: "Calendar", href: "/study?tab=calendar", icon: <GraduationCap className="h-4 w-4" />, keywords: "study plan schedule due" },
  { label: "Ask", href: "/ask", icon: <Search className="h-4 w-4" />, keywords: "chat question rag" },
  { label: "Map", href: "/map", icon: <Network className="h-4 w-4" />, keywords: "graph knowledge" },
  { label: "Tags", href: "/tags", icon: <Hash className="h-4 w-4" />, keywords: "labels taxonomy" },
  { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" />, keywords: "preferences account" },
];

function hitIcon(kind: GlobalSearchHit["kind"]) {
  const cls = "h-4 w-4 text-muted-foreground";
  if (kind === "article" || kind === "saved_article") return <Newspaper className={cls} />;
  if (kind === "uploaded_document") return <FileText className={cls} />;
  return <NotebookPen className={cls} />;
}

/**
 * App-wide ⌘K command palette. Jumps between sections and runs cross-surface
 * search (articles + Directory items) without leaving the keyboard.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K toggle, plus a custom event so touch UIs (the mobile
  // top-bar search button) can open the palette without a keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Reset on open/close. Opening also signals imminent navigation, so warm
  // every jump target (full prefetch; deduped against the sidebar's by the
  // router cache) — Enter then renders from cache instead of a skeleton.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
      for (const { href } of NAV) router.prefetch(href);
    }
  }, [open, router]);

  // Debounced cross-surface search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await globalSearchAction(q);
        setHits(res);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const actionMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS;
    return ACTIONS.filter(
      (a) => a.label.toLowerCase().includes(q) || (a.keywords ?? "").includes(q),
    );
  }, [query]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter(
      (n) => n.label.toLowerCase().includes(q) || (n.keywords ?? "").includes(q),
    );
  }, [query]);

  // Flattened option list for keyboard nav: actions, then nav commands, then hits.
  const options = useMemo(
    () => [
      ...actionMatches.map((a) => ({ kind: "action" as const, node: a })),
      ...navMatches.map((n) => ({ kind: "nav" as const, href: n.href, node: n })),
      ...hits.map((h) => ({ kind: "hit" as const, href: h.href, node: h })),
    ],
    [actionMatches, navMatches, hits],
  );

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, options.length - 1)));
  }, [options.length]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const runOption = useCallback(
    (opt: (typeof options)[number]) => {
      if (opt.kind === "action") {
        setOpen(false);
        opt.node.run();
      } else {
        go(opt.href);
      }
    },
    [go],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = options[active];
      if (sel) runOption(sel);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-[50%] top-[15%] z-50 w-full max-w-xl translate-x-[-50%] overflow-hidden rounded-xl border border-border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Jump to… or search your library"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {searching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {options.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {query.trim().length >= 2 ? "No matches." : "Type to search."}
              </div>
            ) : (
              <>
                {actionMatches.length > 0 && (
                  <Section label="Actions">
                    {actionMatches.map((a, i) => (
                      <Row
                        key={a.label}
                        icon={a.icon}
                        title={a.label}
                        activeRow={active === i}
                        onHover={() => setActive(i)}
                        onClick={() => {
                          setOpen(false);
                          a.run();
                        }}
                      />
                    ))}
                  </Section>
                )}
                {navMatches.length > 0 && (
                  <Section label="Go to">
                    {navMatches.map((n, i) => {
                      const idx = actionMatches.length + i;
                      return (
                        <Row
                          key={n.href}
                          icon={n.icon}
                          title={n.label}
                          activeRow={active === idx}
                          onHover={() => setActive(idx)}
                          onClick={() => go(n.href)}
                        />
                      );
                    })}
                  </Section>
                )}
                {hits.length > 0 && (
                  <Section label="Library">
                    {hits.map((h, i) => {
                      const idx = actionMatches.length + navMatches.length + i;
                      return (
                        <Row
                          key={h.kind + h.id}
                          icon={hitIcon(h.kind)}
                          title={h.title}
                          subtitle={h.snippet ?? undefined}
                          activeRow={active === idx}
                          onHover={() => setActive(idx)}
                          onClick={() => go(h.href)}
                        />
                      );
                    })}
                  </Section>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span>↑↓ navigate</span>
            <span>⏎ open</span>
            <span>esc close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="editorial-eyebrow-brand px-2 py-1">§ {label}</div>
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  activeRow,
  onHover,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  activeRow: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      // Keep the keyboard-highlighted row visible inside the scroll container.
      ref={activeRow ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
        activeRow ? "bg-accent text-accent-foreground" : "text-foreground",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}

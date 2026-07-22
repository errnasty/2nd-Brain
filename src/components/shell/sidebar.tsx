"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import {
  GraduationCap,
  Library,
  Lightbulb,
  Loader2,
  MessageCircle,
  Network,
  Rabbit,
  Rss,
  Search,
  Sparkles,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getScopedItem, setScopedItem } from "@/lib/settings";
import { LinkPendingReporter } from "@/components/shell/route-progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// `chord` is the second key of the `g`-prefixed jump shortcut (see GlobalShortcuts).
const nav = [
  { href: "/today", label: "Today", icon: Sparkles, chord: "T" },
  { href: "/ask", label: "Ask", icon: MessageCircle, chord: "A" },
  { href: "/feeds", label: "Feeds", icon: Rss, chord: "F" },
  { href: "/directory", label: "Directory", icon: Library, chord: "D" },
  { href: "/study", label: "Study", icon: GraduationCap, chord: "S" },
  { href: "/thinktank", label: "ThinkTank", icon: Lightbulb, chord: "K" },
  { href: "/rabbithole", label: "Rabbithole", icon: Rabbit, chord: "R" },
  { href: "/map", label: "Knowledge Map", icon: Network, chord: "M" },
  { href: "/tags", label: "Tags", icon: Tag, chord: "G" },
];

const VOLUME_KEY = "sidebar.volumeNumber.v1";

export function Sidebar({
  userEmail,
  displayName,
}: {
  userEmail: string;
  displayName?: string | null;
}) {
  const pathname = usePathname();
  // ⌘ on macOS, Ctrl elsewhere. Resolved after mount to avoid hydration mismatch.
  const [mod, setMod] = useState("⌘");
  // Editorial "issue number" displayed next to the wordmark. Increments on each
  // calendar day the app is opened — gives the masthead a printed-edition feel
  // without any backend wiring. Persists in localStorage; falls back to today's
  // day-of-year if unset so a fresh install still shows something useful.
  const [volume, setVolume] = useState<number | null>(null);

  useEffect(() => {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
    setMod(isMac ? "⌘" : "Ctrl");

    try {
      const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const raw = getScopedItem(VOLUME_KEY);
      const parsed = raw ? (JSON.parse(raw) as { n: number; lastDay: string }) : null;
      if (parsed && parsed.lastDay === todayKey) {
        setVolume(parsed.n);
      } else {
        const next = parsed ? parsed.n + 1 : dayOfYear(new Date());
        setScopedItem(VOLUME_KEY, JSON.stringify({ n: next, lastDay: todayKey }));
        setVolume(next);
      }
    } catch {
      setVolume(dayOfYear(new Date()));
    }
  }, []);

  function isActive(href: string): boolean {
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  }

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border lg:flex lg:flex-col">
      <div className="px-4 py-5">
        <div className="flex items-center gap-2">
          <BrandMark className="h-[15px] w-[18px] text-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold leading-none tracking-tight">Second Brain</span>
            {volume != null && (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ color: "hsl(var(--brand))" }}
                title="Issue number — increments daily"
              >
                № {volume}
              </span>
            )}
          </div>
        </div>
        {displayName && (
          <div className="mt-1 truncate text-xs font-medium">{displayName}</div>
        )}
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{userEmail}</div>
      </div>
      <Separator />

      {/* Surfaces the command palette (otherwise ⌘K-only / invisible). */}
      <div className="px-2 pt-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
            {mod}K
          </kbd>
        </button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2">
          {nav.map(({ href, label, icon: Icon, chord }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                // Full prefetch (RSC data included, not just the loading
                // boundary): the sidebar is always in the viewport, so every
                // section is fetched once at load and tab switches render from
                // the router cache (staleTimes.dynamic) with no skeleton.
                prefetch={true}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/item relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />
                )}
                <Icon className={cn("h-4 w-4", active && "text-brand")} />
                <span className="flex-1">{label}</span>
                <NavHint chord={chord} />
                <LinkPendingReporter />
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
      <Separator />
      <div className="space-y-0.5 p-2">
        <Link
          href="/guide"
          aria-current={isActive("/guide") ? "page" : undefined}
          className={cn(
            "block rounded-md px-3 py-2 text-sm transition-colors",
            isActive("/guide")
              ? "bg-accent font-semibold text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          Guide
        </Link>
        <Link
          href="/settings"
          prefetch={true}
          aria-current={isActive("/settings") ? "page" : undefined}
          className={cn(
            "block rounded-md px-3 py-2 text-sm transition-colors",
            isActive("/settings")
              ? "bg-accent font-semibold text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          Settings
        </Link>
      </div>
    </aside>
  );
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/**
 * While the clicked link's route is loading, show a spinner; otherwise the
 * hover-revealed jump-shortcut hint. useLinkStatus reads the pending state of
 * the enclosing <Link>.
 */
function NavHint({ chord }: { chord: string }) {
  const { pending } = useLinkStatus();
  if (pending) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  return (
    <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100">
      G {chord}
    </kbd>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap,
  Library,
  MessageCircle,
  Network,
  Rss,
  Sparkles,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const nav = [
  { href: "/today", label: "Today", icon: Sparkles },
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/directory", label: "Directory", icon: Library },
  { href: "/study", label: "Study", icon: GraduationCap },
  { href: "/map", label: "Knowledge Map", icon: Network },
  { href: "/tags", label: "Tags", icon: Tag },
];

export function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  }

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border md:flex md:flex-col">
      <div className="px-4 py-5">
        <div className="text-base font-semibold tracking-tight leading-none">Second Brain</div>
        <div className="mt-1 text-[11px] text-muted-foreground truncate">{userEmail}</div>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="p-2 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />
                )}
                <Icon className={cn("h-4 w-4", active && "text-brand")} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
      <Separator />
      <div className="p-2">
        <Link
          href="/settings"
          className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Settings
        </Link>
      </div>
    </aside>
  );
}

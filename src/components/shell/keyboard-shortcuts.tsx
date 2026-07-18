"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Keyboard } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Single source of truth for shortcuts — rendered in the reference dialog AND
// drives the global chord handler below. `keys` is for display; `chord` (if
// present) is the second key after `g` that triggers navigation.
type Shortcut = { keys: string[]; label: string; chord?: string; href?: string };
type Group = { title: string; items: Shortcut[] };

export const SHORTCUT_GROUPS: Group[] = [
  {
    title: "Global",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette / search" },
      { keys: ["c"], label: "Quick capture a note" },
      { keys: ["?"], label: "Show this shortcuts reference" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["g", "t"], label: "Today", chord: "t", href: "/today" },
      { keys: ["g", "a"], label: "Ask", chord: "a", href: "/ask" },
      { keys: ["g", "f"], label: "Feeds", chord: "f", href: "/feeds" },
      { keys: ["g", "d"], label: "Directory", chord: "d", href: "/directory" },
      { keys: ["g", "s"], label: "Study", chord: "s", href: "/study" },
      { keys: ["g", "k"], label: "ThinkTank", chord: "k", href: "/thinktank" },
      { keys: ["g", "r"], label: "Rabbithole", chord: "r", href: "/rabbithole" },
      { keys: ["g", "m"], label: "Knowledge Map", chord: "m", href: "/map" },
      { keys: ["g", "g"], label: "Tags", chord: "g", href: "/tags" },
    ],
  },
  {
    title: "Reader & lists (Feeds / Directory)",
    items: [
      { keys: ["j"], label: "Next item" },
      { keys: ["k"], label: "Previous item" },
      { keys: ["m"], label: "Mark read / unread" },
      { keys: ["s"], label: "Star" },
      { keys: ["v"], label: "Open original" },
      { keys: ["esc"], label: "Close reader" },
    ],
  },
  {
    title: "Flashcard review (Study)",
    items: [
      { keys: ["space"], label: "Show answer" },
      { keys: ["1"], label: "Grade: Again" },
      { keys: ["2"], label: "Grade: Hard" },
      { keys: ["3"], label: "Grade: Good" },
      { keys: ["4"], label: "Grade: Easy" },
    ],
  },
];

// chord key → destination, derived from the data above.
const CHORDS: Record<string, string> = Object.fromEntries(
  SHORTCUT_GROUPS.flatMap((g) => g.items)
    .filter((s) => s.chord && s.href)
    .map((s) => [s.chord!, s.href!]),
);

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Always-mounted global handler: `g`-prefixed navigation chords + `?` to open
 * the reference. (⌘K lives in CommandPalette.) Ignores keys while typing.
 */
export function GlobalShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();

      if (key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }

      // `c` — quick capture from anywhere (component listens for the event).
      if (key === "c" && !pending) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-quick-capture"));
        return;
      }

      if (pending) {
        pending = false;
        if (timer) clearTimeout(timer);
        const href = CHORDS[key];
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }

      if (key === "g") {
        pending = true;
        timer = setTimeout(() => {
          pending = false;
        }, 1000);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return <ShortcutsDialog open={open} onOpenChange={setOpen} />;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-xl border border-border bg-background p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </DialogPrimitive.Title>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-foreground/90">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((k, i) => (
                          <kbd
                            key={i}
                            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Tip: press <kbd className="rounded border border-border bg-muted px-1">?</kbd> anywhere to
            reopen this.
          </p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/** Settings-pane entry: a button that opens the reference dialog. */
export function SettingsShortcuts() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Navigate fast with the keyboard. Press ? anytime.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          View shortcuts
        </Button>
      </div>
      <ShortcutsDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

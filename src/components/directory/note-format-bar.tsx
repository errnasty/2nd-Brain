"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Brackets,
  Check,
  Code,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  Redo2,
  TextQuote,
  Undo2,
} from "lucide-react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import {
  cycleHeading,
  insertLink,
  insertWikilink,
  toggleBullet,
  toggleQuote,
  toggleTaskLine,
  toggleWrap,
} from "./note-commands";

/**
 * How much of the layout viewport something (almost always the on-screen
 * keyboard) is covering, in px.
 *
 * `position: fixed` is anchored to the *layout* viewport, so on iOS a bar
 * pinned to `bottom: 0` sits underneath the keyboard rather than above it.
 * visualViewport is the only way to find out where the keyboard actually ends.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Sub-pixel noise and the odd 1px rounding shouldn't lift the bar.
      setInset(covered > 24 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}

/** True while the app's mobile bottom tab bar is on screen (it is `lg:hidden`). */
function useHasBottomNav(): boolean {
  const [has, setHas] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setHas(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return has;
}

type Action = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (view: EditorView) => boolean;
};

const ACTIONS: Action[] = [
  { key: "undo", label: "Undo", icon: Undo2, run: undo },
  { key: "redo", label: "Redo", icon: Redo2, run: redo },
  { key: "heading", label: "Heading", icon: Heading, run: cycleHeading },
  { key: "bold", label: "Bold", icon: Bold, run: toggleWrap("**") },
  { key: "italic", label: "Italic", icon: Italic, run: toggleWrap("_") },
  { key: "bullet", label: "Bullet list", icon: List, run: toggleBullet },
  { key: "task", label: "Checklist", icon: ListChecks, run: toggleTaskLine },
  { key: "quote", label: "Quote", icon: TextQuote, run: toggleQuote },
  { key: "code", label: "Code", icon: Code, run: toggleWrap("`") },
  { key: "link", label: "Link", icon: LinkIcon, run: insertLink },
  { key: "wikilink", label: "Link a note", icon: Brackets, run: insertWikilink },
];

/**
 * Formatting bar for touch devices, riding just above the on-screen keyboard.
 *
 * Only rendered for coarse pointers: on a desktop the same commands are on
 * ⌘B / ⌘I / ⌘K and a permanent bar would be clutter.
 */
export function NoteFormatBar({
  view,
  visible,
  onDone,
}: {
  view: EditorView | null;
  visible: boolean;
  /** Leaves edit mode. Pinned outside the scrolling row so it is always
   *  reachable — with the keyboard up it is the only way back to reading. */
  onDone?: () => void;
}) {
  const inset = useKeyboardInset();
  const hasBottomNav = useHasBottomNav();

  if (!visible || !view) return null;

  const bottom =
    inset > 0
      ? `${inset}px`
      : hasBottomNav
        ? "calc(3.5rem + env(safe-area-inset-bottom))"
        : "env(safe-area-inset-bottom)";

  // Portalled to the body: a `position: fixed` bar is measured against the
  // nearest transformed ancestor, and the viewer animates itself in on mount.
  return createPortal(
    <div
      // z-40 matches the bottom tab bar it stacks on top of.
      className="fixed inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      style={{ bottom }}
    >
      <div className="flex items-stretch">
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ACTIONS.map(({ key, label, icon: Icon, run }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            title={label}
            // Tapping a button must not blur the editor — losing focus would
            // close the keyboard and drop the selection the command acts on.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              run(view);
              view.focus();
            }}
            className={cn(
              "flex h-11 min-w-[2.75rem] shrink-0 items-center justify-center rounded-md px-2",
              "text-muted-foreground transition-colors active:bg-accent active:text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        ))}
      </div>

      {onDone && (
        <button
          type="button"
          aria-label="Done editing"
          title="Done"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            view.contentDOM.blur();
            onDone();
          }}
          className="my-1 mr-1 flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground active:bg-accent"
        >
          <Check className="h-[18px] w-[18px]" />
          Done
        </button>
      )}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  GraduationCap,
  Keyboard,
  Library,
  MessageCircle,
  Network,
  NotebookPen,
  Rss,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DONE_KEY = "onboarding.v1.done";

type Step = {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
};

const brass = { color: "hsl(var(--brand))" };

const STEPS: Step[] = [
  {
    eyebrow: "Welcome",
    title: "Your Second Brain.",
    icon: <Sparkles className="h-6 w-6" style={brass} />,
    body: (
      <>
        A private home for everything you read, write, and want to remember — your articles, notes,
        and documents in one searchable library, with an AI that actually knows your stuff. Quick
        tour: about 60 seconds.
      </>
    ),
  },
  {
    eyebrow: "1 · Capture",
    title: "Grab ideas before they vanish.",
    icon: <NotebookPen className="h-6 w-6" style={brass} />,
    body: (
      <>
        Press <Kbd>c</Kbd> anywhere to jot a quick note. Upload PDFs/docs in the Directory, or save
        any article from Feeds with the bookmark button. Everything lands in your{" "}
        <strong>Unsorted</strong> inbox to organize later.
      </>
    ),
  },
  {
    eyebrow: "2 · Today",
    title: "Your Daily Brief.",
    icon: <Sparkles className="h-6 w-6" style={brass} />,
    body: (
      <>
        Each day, the AI triages your unread articles into a punchy dashboard — what to read now,
        themes to skim, and low-signal items to skip. Open it from <strong>Today</strong>.
      </>
    ),
  },
  {
    eyebrow: "3 · Feeds",
    title: "Read the web, your way.",
    icon: <Rss className="h-6 w-6" style={brass} />,
    body: (
      <>
        Subscribe to RSS feeds, organize them into folders, and read distraction-free. Star
        favourites, save to <strong>Read Later</strong>, or save the best into your Directory.
      </>
    ),
  },
  {
    eyebrow: "4 · Directory",
    title: "Capture → Organize → Distill → Express.",
    icon: <Library className="h-6 w-6" style={brass} />,
    body: (
      <>
        Your permanent library. Sort items into folders and tags, then hit{" "}
        <Wand2 className="inline h-3.5 w-3.5 align-text-bottom" /> <strong>Distill</strong> to pin an
        AI &ldquo;essence&rdquo; (TL;DR + key points) on any item — and turn it into flashcards in
        one click.
      </>
    ),
  },
  {
    eyebrow: "5 · Study",
    title: "Learning that levels you up.",
    icon: <GraduationCap className="h-6 w-6" style={brass} />,
    body: (
      <>
        Completing tasks, reviewing flashcards, reading, and distilling all earn <strong>XP</strong>.
        Your <strong>skills</strong> grow and evolve through rarity tiers, you keep a daily streak,
        and spaced-repetition review tells you exactly what&apos;s due.
      </>
    ),
  },
  {
    eyebrow: "6 · Ask",
    title: "Chat with your knowledge.",
    icon: <MessageCircle className="h-6 w-6" style={brass} />,
    body: (
      <>
        Ask questions in plain language and get answers grounded in <em>your</em> library, with
        numbered citations back to the source. Optionally let it search the web to fill gaps.
      </>
    ),
  },
  {
    eyebrow: "7 · Map & Tags",
    title: "See the shape of what you know.",
    icon: <Network className="h-6 w-6" style={brass} />,
    body: (
      <>
        The Knowledge Map draws the connections between your items, folders, and tags — click any
        node for details, or focus its local graph. Filter the Directory by tag from the sidebar.
      </>
    ),
  },
  {
    eyebrow: "Shortcuts",
    title: "Move fast.",
    icon: <Keyboard className="h-6 w-6" style={brass} />,
    body: (
      <>
        <Kbd>⌘K</Kbd> / <Kbd>Ctrl K</Kbd> opens the command palette &amp; search. <Kbd>c</Kbd>{" "}
        captures a note. <Kbd>g</Kbd> then a letter jumps between sections. Press <Kbd>?</Kbd> anytime
        for the full list. That&apos;s it — enjoy building your Second Brain.
      </>
    ),
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium">
      {children}
    </kbd>
  );
}

/**
 * First-run product tour. A route-agnostic step modal (no fragile element
 * anchoring) — auto-opens once, remembers completion in localStorage, and can be
 * replayed via the `open-onboarding` event (command palette / settings).
 */
export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  // Auto-open on first ever visit.
  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(DONE_KEY) === "1";
    } catch {
      // ignore
    }
    if (!done) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  // Replay trigger.
  useEffect(() => {
    function onOpen() {
      setI(0);
      setOpen(true);
    }
    window.addEventListener("open-onboarding", onOpen);
    return () => window.removeEventListener("open-onboarding", onOpen);
  }, []);

  function finish() {
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }

  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Closing the tour (X / overlay / Esc) counts as "seen" so it won't nag.
        if (!v) finish();
        else setOpen(true);
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
                {step.icon}
              </div>
              <div className="editorial-eyebrow-brand">§ {step.eyebrow}</div>
            </div>

            <DialogPrimitive.Title
              className="editorial-display mt-4 text-2xl"
              style={{ letterSpacing: "-0.018em" }}
            >
              {step.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              {step.body}
            </DialogPrimitive.Description>

            {/* Progress dots */}
            <div className="mt-6 flex items-center gap-1.5">
              {STEPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setI(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    idx === i ? "w-5" : "w-1.5 bg-border hover:bg-muted-foreground/40",
                  )}
                  style={idx === i ? { background: "hsl(var(--brand))" } : undefined}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
            <button
              onClick={finish}
              className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
            <div className="flex items-center gap-2">
              {i > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setI((n) => n - 1)}>
                  Back
                </Button>
              )}
              {last ? (
                <Button size="sm" variant="brand" onClick={finish}>
                  Get started
                </Button>
              ) : (
                <Button size="sm" variant="brand" onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))}>
                  Next
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

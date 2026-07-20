"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  GraduationCap,
  Keyboard,
  Library,
  Lightbulb,
  MessageCircle,
  NotebookPen,
  Palette,
  Rss,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PALETTE_OPTIONS,
  getPalette,
  getScopedItem,
  setPalette,
  setScopedItem,
  type PaletteId,
} from "@/lib/settings";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import { updateDisplayNameAction } from "@/lib/profile/actions";

// Legacy browser-global flag (pre server-side gating). Still written as a
// scoped fast-path cache; the server's onboardingDone is authoritative.
const DONE_KEY = "onboarding.v1.done";

// Starter chips for the "what do you want to learn?" step. Free text adds more.
const SUGGESTED_INTERESTS = [
  "Philosophy",
  "History",
  "Psychology",
  "Investing",
  "AI & machine learning",
  "Programming",
  "Health & fitness",
  "Productivity",
  "Writing",
  "Science",
  "Design",
  "Economics",
];

const brass = { color: "hsl(var(--brand))" };

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium">
      {children}
    </kbd>
  );
}

// Condensed informational tour (after the interactive steps).
const TOUR_STEPS = [
  {
    eyebrow: "Capture",
    title: "Grab ideas before they vanish.",
    icon: <NotebookPen className="h-6 w-6" style={brass} />,
    body: (
      <>
        Press <Kbd>c</Kbd> anywhere to jot a quick note. Upload PDFs/docs in the Directory, or save
        any article from Feeds. Everything lands in your <strong>Unsorted</strong> inbox to organize
        later.
      </>
    ),
  },
  {
    eyebrow: "Today & Feeds",
    title: "Your reading, triaged daily.",
    icon: <Rss className="h-6 w-6" style={brass} />,
    body: (
      <>
        Subscribe to RSS feeds and read distraction-free. Each day, <strong>Today</strong> turns
        your unread pile into a punchy brief — what to read now, what to skim, what to skip.
      </>
    ),
  },
  {
    eyebrow: "Directory & Study",
    title: "Capture → Organize → Distill → Learn.",
    icon: <Library className="h-6 w-6" style={brass} />,
    body: (
      <>
        The Directory is your permanent library — sort into folders and tags, hit{" "}
        <Wand2 className="inline h-3.5 w-3.5 align-text-bottom" /> <strong>Distill</strong> for an
        AI essence, and turn anything into flashcards. Reviewing earns <strong>XP</strong>, levels
        your <GraduationCap className="inline h-3.5 w-3.5 align-text-bottom" /> skills, and keeps a
        streak.
      </>
    ),
  },
  {
    eyebrow: "Ask & Shortcuts",
    title: "Chat with your knowledge. Move fast.",
    icon: <MessageCircle className="h-6 w-6" style={brass} />,
    body: (
      <>
        <strong>Ask</strong> answers in plain language, grounded in <em>your</em> library with
        citations. <Kbd>⌘K</Kbd> opens search, <Kbd>c</Kbd> captures, <Kbd>g</Kbd> then a letter
        jumps between sections, <Kbd>?</Kbd> shows every shortcut.{" "}
        <Keyboard className="inline h-3.5 w-3.5 align-text-bottom" /> That&apos;s the tour — enjoy
        building your Second Brain.
      </>
    ),
  },
];

// Step ids, in order: 3 interactive steps then the condensed tour.
const INTERACTIVE_STEPS = 4; // welcome, name, interests, palette
const TOTAL_STEPS = INTERACTIVE_STEPS + TOUR_STEPS.length;

/**
 * First-run experience: a short personalization flow (name → interests →
 * look) followed by a condensed product tour. Auto-opens once per account —
 * gated by the server-side `onboardingDone` setting (cross-device), with the
 * legacy/scoped localStorage flag as a fast path — and can be replayed via the
 * `open-onboarding` event (command palette / settings), which re-runs it with
 * previous answers prefilled.
 */
export function Onboarding({
  initialDone,
  initialName,
  initialInterests,
  initialOpen = false,
}: {
  initialDone: boolean;
  initialName: string | null;
  initialInterests: string[];
  /** Open the tour immediately on mount — used by the lazy shell wrapper when
   *  the panel is mounted in response to `open-onboarding` (the chunk wasn't
   *  loaded yet, so the event predates our listener). */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [i, setI] = useState(0);
  const [name, setName] = useState(initialName ?? "");
  const [interests, setInterests] = useState<string[]>(initialInterests);
  const [customInterest, setCustomInterest] = useState("");
  const [palette, setPaletteState] = useState<PaletteId>("parchment");

  // Auto-open on the account's first ever visit. Server flag is authoritative;
  // a legacy local flag (pre server-gating) is silently backfilled so existing
  // users are never re-nagged.
  useEffect(() => {
    if (initialDone) return;
    let legacyDone = false;
    try {
      legacyDone =
        getScopedItem(DONE_KEY) === "1" || localStorage.getItem(DONE_KEY) === "1";
    } catch {
      // ignore
    }
    if (legacyDone) {
      void updateUserSettingsAction({ onboardingDone: true });
      return;
    }
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [initialDone]);

  // Replay trigger.
  useEffect(() => {
    function onOpen() {
      setI(0);
      setOpen(true);
    }
    window.addEventListener("open-onboarding", onOpen);
    return () => window.removeEventListener("open-onboarding", onOpen);
  }, []);

  // Palette state mirrors the live setting once the dialog opens.
  useEffect(() => {
    if (open) setPaletteState(getPalette());
  }, [open]);

  function finish() {
    setScopedItem(DONE_KEY, "1"); // fast path for this browser
    void updateUserSettingsAction({ onboardingDone: true });
    // Persist whatever was entered, even when finishing early via X / Skip.
    const trimmed = name.trim();
    if (trimmed !== (initialName ?? "")) void updateDisplayNameAction(trimmed);
    if (JSON.stringify(interests) !== JSON.stringify(initialInterests)) {
      void updateUserSettingsAction({ interests });
    }
    setOpen(false);
  }

  function toggleInterest(topic: string) {
    setInterests((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  }

  function addCustomInterest() {
    const t = customInterest.trim();
    if (!t) return;
    if (!interests.includes(t)) setInterests((prev) => [...prev, t]);
    setCustomInterest("");
  }

  const last = i === TOTAL_STEPS - 1;
  const tourStep = i >= INTERACTIVE_STEPS ? TOUR_STEPS[i - INTERACTIVE_STEPS] : null;

  const header = (eyebrow: string, icon: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
        {icon}
      </div>
      <div className="editorial-eyebrow-brand">§ {eyebrow}</div>
    </div>
  );

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
            {i === 0 && (
              <>
                {header("Welcome", <Sparkles className="h-6 w-6" style={brass} />)}
                <DialogPrimitive.Title className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                  Your Second Brain.
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  A private home for everything you read, write, and want to remember — with an AI
                  that actually knows your stuff. Let&apos;s make it yours: about 90 seconds.
                </DialogPrimitive.Description>
              </>
            )}

            {i === 1 && (
              <>
                {header("1 · You", <UserRound className="h-6 w-6" style={brass} />)}
                <DialogPrimitive.Title className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                  What should we call you?
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  Your name personalizes the daily brief and your workspace. Optional — skip if you
                  like.
                </DialogPrimitive.Description>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setI(2)}
                  placeholder="Your name"
                  maxLength={60}
                  className="mt-4"
                />
              </>
            )}

            {i === 2 && (
              <>
                {header("2 · Interests", <Lightbulb className="h-6 w-6" style={brass} />)}
                <DialogPrimitive.Title className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                  What do you want to learn?
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  Pick a few topics — ThinkTank uses them to suggest things to explore. You can
                  change these anytime in Settings.
                </DialogPrimitive.Description>
                <div className="mt-4 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {[...SUGGESTED_INTERESTS, ...interests.filter((t) => !SUGGESTED_INTERESTS.includes(t))].map(
                    (topic) => {
                      const on = interests.includes(topic);
                      return (
                        <button
                          key={topic}
                          onClick={() => toggleInterest(topic)}
                          aria-pressed={on}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            on
                              ? "border-transparent bg-brand text-brand-foreground"
                              : "border-border bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {topic}
                          {on && <X className="ml-1 inline h-3 w-3" />}
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={customInterest}
                    onChange={(e) => setCustomInterest(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomInterest();
                      }
                    }}
                    placeholder="Add your own topic…"
                    className="h-9 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={addCustomInterest} disabled={!customInterest.trim()}>
                    Add
                  </Button>
                </div>
              </>
            )}

            {i === 3 && (
              <>
                {header("3 · Look", <Palette className="h-6 w-6" style={brass} />)}
                <DialogPrimitive.Title className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                  Make it yours.
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  Pick a colour palette — it applies immediately. Fonts, text size, and dark mode
                  live in Settings.
                </DialogPrimitive.Description>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {PALETTE_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPaletteState(p.id);
                        setPalette(p.id);
                      }}
                      aria-pressed={palette === p.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                        palette === p.id
                          ? "border-transparent bg-accent font-semibold ring-2 ring-brand"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {tourStep && (
              <>
                {header(tourStep.eyebrow, tourStep.icon)}
                <DialogPrimitive.Title className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                  {tourStep.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {tourStep.body}
                </DialogPrimitive.Description>
              </>
            )}

            {/* Progress dots */}
            <div className="mt-6 flex items-center gap-1.5">
              {Array.from({ length: TOTAL_STEPS }, (_, idx) => (
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
            {last ? (
              <a
                href="/guide"
                onClick={finish}
                className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                Read the full guide →
              </a>
            ) : (
              <button
                onClick={finish}
                className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                Skip
              </button>
            )}
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
                <Button size="sm" variant="brand" onClick={() => setI((n) => Math.min(TOTAL_STEPS - 1, n + 1))}>
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

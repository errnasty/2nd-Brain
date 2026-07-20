"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Sparkles, Wrench, Bug, X } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CHANGELOG,
  LATEST_CHANGELOG_ID,
  unseenChangelog,
  type ChangelogEntry,
  type ChangelogTag,
} from "@/data/changelog";
import { updateUserSettingsAction } from "@/lib/settings/actions";

const ONBOARDING_DONE_KEY = "onboarding.v1.done";

const TAG_META: Record<ChangelogTag, { label: string; icon: React.ReactNode; className: string }> = {
  feature: {
    label: "New",
    icon: <Sparkles className="h-3 w-3" />,
    className: "border-[hsl(var(--brand))]/40 text-[hsl(var(--brand))]",
  },
  improvement: {
    label: "Improved",
    icon: <Wrench className="h-3 w-3" />,
    className: "border-border text-muted-foreground",
  },
  fix: {
    label: "Fixed",
    icon: <Bug className="h-3 w-3" />,
    className: "border-border text-muted-foreground",
  },
};

/**
 * "What's New" — shows changelog entries the user hasn't acknowledged yet
 * (newer than their saved watermark in userSettings). Auto-opens once on entry
 * when there are unseen entries; dismissing writes the watermark so it won't
 * nag. Re-openable anytime via the `open-whats-new` CustomEvent (command
 * palette / settings / guide), which shows the full history.
 *
 * Mirrors the first-run Onboarding modal's visual language.
 */
export function WhatsNew({
  lastSeen,
  onboardingDone,
  initialOpen = false,
}: {
  lastSeen: string | null;
  /** Server-side onboarding flag (authoritative since per-user gating). */
  onboardingDone?: boolean;
  /** Open immediately on mount showing the full history — used by the lazy
   *  shell wrapper when the panel is mounted in response to `open-whats-new`
   *  (the chunk wasn't loaded yet, so the event predates our listener). */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [showAll, setShowAll] = useState(initialOpen);
  const unseen = useMemo(() => unseenChangelog(lastSeen), [lastSeen]);

  // Auto-open once for unseen entries — but not before the first-run tour is
  // done (a brand-new user shouldn't get two modals stacked).
  useEffect(() => {
    if (unseen.length === 0) return;
    let onboarded = onboardingDone === true;
    try {
      // Legacy browser-global flag still counts for pre-server-flag sessions.
      onboarded ||= localStorage.getItem(ONBOARDING_DONE_KEY) === "1";
    } catch {
      // ignore
    }
    if (!onboarded) return;
    const t = setTimeout(() => {
      setShowAll(false);
      setOpen(true);
    }, 700);
    return () => clearTimeout(t);
  }, [unseen.length, onboardingDone]);

  // Anytime access — shows the full history.
  useEffect(() => {
    function onOpen() {
      setShowAll(true);
      setOpen(true);
    }
    window.addEventListener("open-whats-new", onOpen);
    return () => window.removeEventListener("open-whats-new", onOpen);
  }, []);

  const acknowledge = useCallback(() => {
    // Persist the watermark only when clearing genuinely-unseen entries.
    if (unseen.length > 0 && LATEST_CHANGELOG_ID) {
      void updateUserSettingsAction({ lastSeenChangelog: LATEST_CHANGELOG_ID }).catch(() => {});
    }
    setOpen(false);
  }, [unseen.length]);

  const entries: ChangelogEntry[] = showAll ? CHANGELOG : unseen;
  if (entries.length === 0 && !open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : acknowledge())}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-center gap-3 border-b border-border p-6 pb-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
              <Sparkles className="h-6 w-6" style={{ color: "hsl(var(--brand))" }} />
            </div>
            <div>
              <div className="editorial-eyebrow-brand">§ What&rsquo;s New</div>
              <DialogPrimitive.Title className="editorial-display mt-1 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                {showAll ? "Recent updates" : "Since you were away"}
              </DialogPrimitive.Title>
            </div>
            <button
              onClick={acknowledge}
              className="ml-auto shrink-0 self-start text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <DialogPrimitive.Description className="sr-only">
            A list of recent changes to the app.
          </DialogPrimitive.Description>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            {entries.map((e) => {
              const meta = TAG_META[e.tag];
              return (
                <article key={e.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                        meta.className,
                      )}
                    >
                      {meta.icon}
                      {meta.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {e.date}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold leading-snug">{e.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{e.summary}</p>
                  {e.items && e.items.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                      {e.items.map((it, idx) => (
                        <li key={idx}>{it}</li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
            <a
              href="/guide"
              className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              New here? Read the guide
            </a>
            <Button size="sm" variant="brand" onClick={acknowledge}>
              Got it
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

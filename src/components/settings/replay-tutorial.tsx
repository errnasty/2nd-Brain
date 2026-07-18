"use client";

import Link from "next/link";
import { BookOpen, Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Help hub: the full guide, the first-run tour (also auto-shows for new users),
 *  and the "What's New" panel. */
export function ReplayTutorial() {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="h-4 w-4" /> Guide &amp; help
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Learn every feature, replay the tour, or see what&rsquo;s changed recently.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="brand">
            <Link href="/guide">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Read the guide
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent("open-onboarding"))}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Replay tour
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent("open-whats-new"))}
          >
            <Gift className="mr-1.5 h-3.5 w-3.5" /> What&rsquo;s New
          </Button>
        </div>
      </div>
    </div>
  );
}

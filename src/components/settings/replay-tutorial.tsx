"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Re-launch the first-run product tour (also auto-shows once for new users). */
export function ReplayTutorial() {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" /> App tutorial
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A quick tour of capture, the Daily Brief, the Directory, Study, and Ask.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.dispatchEvent(new CustomEvent("open-onboarding"))}
        >
          Replay tour
        </Button>
      </div>
    </div>
  );
}

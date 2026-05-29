"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Route-level error boundary for the authenticated app. Catches render/runtime
 * errors in any (app) page and offers recovery instead of a blank crash.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          This view hit an error and couldn&apos;t render. Your data is safe — try again.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-muted-foreground/70">Reference: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset} size="sm">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  );
}

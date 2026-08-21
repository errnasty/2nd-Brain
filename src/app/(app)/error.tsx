"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Route-level error boundary for the authenticated app. Catches render/runtime
 * errors in any (app) page and offers recovery instead of a blank crash.
 *
 * ## Why it can't always just re-render
 *
 * `reset()` re-renders the same tree from the same loaded JavaScript, which
 * fixes a transient error and cannot possibly fix a missing script.
 *
 * That second case is real here and it is the one that looks worst. Several
 * heavy views are lazily imported — the Directory's item viewer and board, the
 * Feeds reader, every dialog — so their code is fetched the moment you first
 * open one, which may be a long time after the page loaded. If a deploy has
 * landed in between, the old build's hashed chunks are gone from the CDN, the
 * import rejects, and the render throws. Pressing "Try again" then re-runs the
 * same failing import forever, which reads as the app being broken rather than
 * merely out of date.
 *
 * A reload is the actual fix: it fetches the current build's HTML and its
 * current chunk names. So a chunk error reloads once, automatically, and says
 * so. The "once" is enforced through a TIMESTAMP in sessionStorage: a second
 * chunk error within RELOAD_GUARD_WINDOW_MS means the reload didn't help (a
 * genuinely broken deploy, or a service worker serving a stale shell), and
 * looping would be worse than stopping and showing the message.
 *
 * It must be a timestamp rather than a sticky flag. A flag could only be
 * cleared from inside this boundary — which renders only when something has
 * ALREADY failed — so a successful recovery left it set forever, and every
 * later deploy skipped its automatic reload and made the user press the button
 * by hand. Expiring the guard means each deploy gets its own free retry while
 * a real loop still stops after one.
 */

/** Errors that mean "the code isn't there", not "the code went wrong". */
function isMissingChunkError(error: Error): boolean {
  const name = error.name ?? "";
  const message = error.message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    // Safari's wording for the same thing.
    /Importing a module script failed/i.test(message)
  );
}

const RELOAD_GUARD_KEY = "app.chunkReload.v2";

/**
 * How long one automatic reload suppresses the next. Long enough to cover the
 * reload itself failing the same way (which is immediate), short enough that
 * the following deploy is treated as a fresh event rather than a repeat.
 */
const RELOAD_GUARD_WINDOW_MS = 15_000;

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [staleBuild, setStaleBuild] = useState(false);

  useEffect(() => {
    console.error("App route error:", error);
    if (!isMissingChunkError(error)) return;
    setStaleBuild(true);
    let alreadyTried = false;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
      alreadyTried = Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_WINDOW_MS;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // Private mode: no guard available. Treat it as "already tried" rather
      // than risk a reload loop we can't detect.
      alreadyTried = true;
    }
    if (!alreadyTried) window.location.reload();
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">
          {staleBuild ? "A new version is available" : "Something went wrong"}
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {staleBuild
            ? "This tab was open while the app updated, so part of it could no longer load. Reloading picks up the new version — your data is untouched."
            : "This view hit an error and couldn't render. Your data is safe — try again."}
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-muted-foreground/70">Reference: {error.digest}</p>
        )}
      </div>
      <Button onClick={staleBuild ? () => window.location.reload() : reset} size="sm">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        {staleBuild ? "Reload" : "Try again"}
      </Button>
    </div>
  );
}

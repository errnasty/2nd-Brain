"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDeckBuilder } from "@/components/thinktank/use-deck-builder";

/**
 * Shown while a deck has no cards yet.
 *
 * Generation is stepped server-side (one bounded pass per request), so this
 * screen's job is to keep the build moving and report progress — `useDeckBuilder`
 * re-kicks until the server says it's done and refreshes the route as cards
 * land. The moment the first cards exist the deck page swaps this out for the
 * reader, which picks the build up from there.
 */
export function DeckGenerating({
  deckId,
  topic,
  failed,
  startedAt,
}: {
  deckId: string;
  topic: string;
  failed: boolean;
  /** When this run was stamped "generating" — drives stall detection. */
  startedAt?: string;
}) {
  const build = useDeckBuilder(deckId, !failed);
  const [dismissedError, setDismissedError] = useState(false);
  const error = (failed && !dismissedError) || Boolean(build.error);
  const errorMsg = build.error;

  // "Taking a little longer" is now a function of real progress, not a
  // stopwatch: a stepped build that is writing cards is working, however long
  // it has been going.
  const [slow, setSlow] = useState(() => !!startedAt && Date.now() - Date.parse(startedAt) > 45_000);
  useEffect(() => {
    if (build.total > 0) return;
    const t = setTimeout(() => setSlow(true), 45_000);
    return () => clearTimeout(t);
  }, [build.total]);

  function retry() {
    setDismissedError(true);
    build.retry();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Link
          href="/thinktank"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to ThinkTank"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="truncate text-sm font-semibold">{topic}</div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          {error ? (
            <>
              <div className="editorial-eyebrow-brand">§ Something went wrong</div>
              <h2 className="editorial-display mt-3 text-xl">Couldn&apos;t build this deck.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {errorMsg || "The generation failed — this is usually temporary. Try again, or pick a broader topic."}
              </p>
              <Button variant="brand" size="sm" className="mt-5 gap-1.5" onClick={retry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </>
          ) : (
            <>
              <Spinner className="mx-auto h-6 w-6 text-brand" />
              <h2 className="editorial-display mt-4 text-xl">Building your deck…</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {build.total > 0
                  ? `Writing your idea cards for “${topic}” — ${build.cards} of ${build.total} done.`
                  : `Planning your deck on “${topic}” and checking the facts${slow ? " — taking a little longer, hang tight" : ""}.`}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

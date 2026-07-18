"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getDeckStatusAction } from "@/app/(app)/thinktank/actions";

/**
 * Shown while a deck's cards are being generated in the background. Kicks
 * /api/thinktank/generate once, then polls the deck status until it's ready
 * and swaps in the reader via router.refresh(). The kick's own response is
 * allowed to fail (that's the serverless-timeout bug this design fixes) —
 * the poll is the source of truth.
 */
export function DeckGenerating({ deckId, topic, failed }: { deckId: string; topic: string; failed: boolean }) {
  const router = useRouter();
  const [error, setError] = useState(failed);
  const [slow, setSlow] = useState(false);
  const kicked = useRef(false);

  function kick() {
    setError(false);
    fetch("/api/thinktank/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deckId }),
    })
      .then(async (res) => {
        // A severed response lands in .catch; an explicit error means the
        // generation itself failed and the poll would spin forever.
        if (!res.ok) setError(true);
      })
      .catch(() => {
        // Ignore: the poll below picks up the finished deck.
      });
  }

  // Kick once per mount (guarded against dev double-invoke). A previously
  // failed deck waits for an explicit retry instead of auto-kicking.
  useEffect(() => {
    if (kicked.current || failed) return;
    kicked.current = true;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll until the cards exist, then re-render the server page into the reader.
  useEffect(() => {
    if (error) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await getDeckStatusAction(deckId);
        if (!r.ok) return;
        if (r.cardCount > 0) {
          clearInterval(timer);
          router.refresh();
          return;
        }
        if (r.status === "error") {
          clearInterval(timer);
          setError(true);
          return;
        }
        if (Date.now() - startedAt > 45_000) setSlow(true);
      } catch {
        // transient poll failure — next tick retries
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [deckId, error, router]);

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
                The generation failed — this is usually temporary. Try again, or pick a broader topic.
              </p>
              <Button variant="brand" size="sm" className="mt-5 gap-1.5" onClick={kick}>
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </>
          ) : (
            <>
              <Spinner className="mx-auto h-6 w-6 text-brand" />
              <h2 className="editorial-display mt-4 text-xl">Building your deck…</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Verifying facts on the web and writing your idea cards for “{topic}”. Usually ~20
                seconds{slow ? " — this one's taking a little longer, hang tight" : ""}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

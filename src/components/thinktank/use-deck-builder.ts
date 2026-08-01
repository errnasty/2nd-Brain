"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Drives a stepped deck build from the client.
 *
 * Deck generation is no longer one long request — the server does one bounded
 * pass per call and answers `done: false` while cards remain (see
 * `src/lib/thinktank/generate.ts`). Something has to keep asking, and it has to
 * survive the two things that used to break it:
 *
 *   - a severed response. On Netlify a function is killed at ~10s, so a kick
 *     may never return at all. A rejected fetch is therefore NOT an error, it's
 *     a normal outcome: re-kick and let the committed progress speak.
 *   - unmounting. The first cards turn the generating screen into the reader,
 *     which is a different component — so the reader drives the rest of the
 *     build with this same hook rather than the build silently stopping
 *     half-written.
 *
 * The hook refreshes the route whenever the card count grows, so cards appear
 * as they're written.
 */

/** Pause between passes. Long enough not to hammer, short enough to feel live. */
const KICK_GAP_MS = 900;

/**
 * Ceiling on passes for one mount. A deep deck is ~4 batches; this leaves room
 * for retries while making it impossible for a bug to kick forever.
 */
const MAX_PASSES = 24;

export type DeckBuildState = {
  /** Cards written so far, as last reported by the server. */
  cards: number;
  /** Cards the outline plans in total; 0 until the outline exists. */
  total: number;
  /** The build finished. */
  done: boolean;
  /** The server reported a real failure (not a severed response). */
  error: string | null;
  /** Kick the build again — for an explicit retry. */
  retry: () => void;
};

export function useDeckBuilder(deckId: string, active: boolean): DeckBuildState {
  const router = useRouter();
  const [cards, setCards] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so the loop reads current values without restarting on every tick.
  const running = useRef(false);
  const cancelled = useRef(false);
  const lastCards = useRef(0);
  const nonce = useRef(0);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    const mine = ++nonce.current;

    try {
      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        if (cancelled.current || nonce.current !== mine) return;

        type Payload = { done?: boolean; cards?: number; total?: number; error?: string };
        let payload: Payload | null = null;
        try {
          const res = await fetch("/api/thinktank/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ deckId }),
          });
          payload = (await res.json().catch(() => null)) as Payload | null;
          if (!res.ok) {
            // An explicit failure is real — the build cannot proceed and the
            // user needs the reason, not another silent retry.
            setError(payload?.error ?? `HTTP ${res.status}`);
            return;
          }
        } catch {
          // Severed response (the ~10s kill, a dropped connection). The pass
          // may well have committed work before dying, so carry on.
          payload = null;
        }

        if (cancelled.current || nonce.current !== mine) return;

        if (payload) {
          if (typeof payload.cards === "number") setCards(payload.cards);
          if (typeof payload.total === "number") setTotal(payload.total);
          // Cards landed since the last pass — show them.
          if (typeof payload.cards === "number" && payload.cards > lastCards.current) {
            lastCards.current = payload.cards;
            router.refresh();
          }
          if (payload.done) {
            setDone(true);
            router.refresh();
            return;
          }
        }

        await new Promise((r) => setTimeout(r, KICK_GAP_MS));
      }
    } finally {
      running.current = false;
    }
  }, [deckId, router]);

  useEffect(() => {
    if (!active) return;
    void run();
    return () => {
      cancelled.current = true;
    };
  }, [active, run]);

  const retry = useCallback(() => {
    setError(null);
    setDone(false);
    running.current = false;
    void run();
  }, [run]);

  return { cards, total, done, error, retry };
}

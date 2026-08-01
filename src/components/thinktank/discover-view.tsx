"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { conceptSlug } from "@/lib/thinktank/concept-slug";

/**
 * The Discover screen: what you probably know about a topic, and what you
 * probably don't.
 *
 * The "may not know" list is the whole point — it should produce the reaction
 * "I've never heard of that and I probably should have". Everything else on
 * this screen is in service of it.
 *
 * ## The split is presented as a guess
 *
 * Because it is one. It's inferred from the user's library, skills and reading
 * history, all of which are partial. Being told you already know something you
 * don't is worse than being told nothing, so the "you know" heading is hedged
 * and every entry in it can be corrected with one tap.
 *
 * ## The self-assessment is inline, not a setup step
 *
 * Asking "tap everything you already know" before showing anything would put a
 * quiz in front of the thing the user came for. Instead each concept carries a
 * quiet "I know this", which does the same job, costs nothing when unused, and
 * doubles as the correction path when the guess is wrong.
 */

type Concept = { name: string; why: string };

type DiscoverResponse = {
  known?: Concept[];
  unknown?: Concept[];
  grounded?: boolean;
  error?: string;
};

export function DiscoverView({
  topic,
  progress,
}: {
  topic: string;
  progress: { explored: number; total: number };
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Concept[]>([]);
  const [unknown, setUnknown] = useState<Concept[]>([]);
  const [grounded, setGrounded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const requested = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/thinktank/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const body = (await res.json().catch(() => null)) as DiscoverResponse | null;
      if (!res.ok) {
        setError(body?.error ?? "Couldn't map this topic");
        return;
      }
      setKnown(body?.known ?? []);
      setUnknown(body?.unknown ?? []);
      setGrounded(Boolean(body?.grounded));
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void load();
  }, [load]);

  /** "I know this" — moves a concept across and remembers it for next time. */
  const markKnown = useCallback(
    (concept: Concept) => {
      setDismissed((prev) => new Set(prev).add(concept.name));
      setKnown((prev) => [...prev, concept]);
      void fetch("/api/thinktank/familiarity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: concept.name, topic, familiarity: "known" }),
      }).catch(() => {
        // The visual move already happened; a lost write only costs us the
        // memory of it, and the user can tap again next time.
      });
    },
    [topic],
  );

  const visibleUnknown = unknown.filter((c) => !dismissed.has(c.name));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-2">
          <Link
            href="/thinktank"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to ThinkTank"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="editorial-eyebrow">Explore</div>
        </div>

        <h1 className="editorial-display text-3xl">{topic}</h1>
        {progress.explored > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;ve explored {progress.explored} concept
            {progress.explored === 1 ? "" : "s"} here.
          </p>
        )}

        {loading && (
          <div className="py-16 text-center">
            <Spinner className="mx-auto h-6 w-6 text-brand" />
            <p className="mt-4 text-sm text-muted-foreground">
              Working out what you already know…
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="py-16 text-center">
            <h2 className="editorial-display text-xl">Couldn&apos;t map this topic.</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{error}</p>
            <Button variant="brand" size="sm" className="mt-5 gap-1.5" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* The payoff, first and largest. */}
            <section className="mt-8">
              <div className="editorial-eyebrow-brand">§ You may not know</div>
              <ul className="mt-3 space-y-2">
                {visibleUnknown.map((c) => (
                  <li
                    key={c.name}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-brand/50"
                  >
                    <Link
                      href={`/thinktank/c/${conceptSlug(c.name)}?topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(c.name)}`}
                      className="min-w-0 flex-1"
                    >
                      <div className="text-sm font-semibold">{c.name}</div>
                      {c.why && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{c.why}</div>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => markKnown(c)}
                      className="shrink-0 rounded px-2 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                      title="Move this to “you already know”"
                    >
                      I know this
                    </button>
                  </li>
                ))}
              </ul>
              {visibleUnknown.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing new to suggest here — try a narrower topic.
                </p>
              )}
            </section>

            {known.length > 0 && (
              <section className="mt-8">
                <div className="editorial-eyebrow">
                  § You probably know{grounded ? "" : " (a guess)"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {known.map((c) => (
                    <Link
                      key={c.name}
                      href={`/thinktank/c/${conceptSlug(c.name)}?topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(c.name)}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-sm text-muted-foreground",
                        "transition-colors hover:border-brand/40 hover:text-foreground",
                      )}
                      title="Open anyway"
                    >
                      <Check className="h-3 w-3" />
                      {c.name}
                    </Link>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {grounded
                    ? "Based on your library and what you've read here. Tap any to read it anyway."
                    : "We don't have much to go on yet — this is a guess. Tap any to read it anyway."}
                </p>
              </section>
            )}

            <p className="mt-10 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Every card takes about two minutes, and links to what comes next.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

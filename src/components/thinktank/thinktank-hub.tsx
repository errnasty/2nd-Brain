"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, Compass, Lightbulb, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DAILY_CARDS } from "@/lib/thinktank/pacing";
import { deckDisplayState, isPollable } from "@/lib/thinktank/stall";
import { createThinkTankDeckAction, deleteDeckAction, getDeckStatusAction } from "@/app/(app)/thinktank/actions";

export type DeckSummary = {
  id: string;
  topic: string;
  title: string;
  description: string | null;
  status: "generating" | "ready" | "error";
  pacing: "free" | "daily";
  detail: "brief" | "standard" | "deep";
  lastPosition: number;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
};

const DETAIL_LABEL = { brief: "Brief", standard: "Standard", deep: "Deep" } as const;

/**
 * ThinkTank hub: type any topic (or tap a suggestion seeded from your
 * interests + tags) and the AI builds a swipeable deck of idea cards.
 */
export type RefresherSummary = {
  slug: string;
  name: string;
  topic: string | null;
};

export function ThinkTankHub({
  decks,
  suggestions,
  refreshers = [],
  exploredTopics = [],
}: {
  decks: DeckSummary[];
  suggestions: string[];
  /** Saved concepts due for a two-minute refresher. */
  refreshers?: RefresherSummary[];
  /** Topics with concepts already read, for one-tap return. */
  exploredTopics?: { topic: string; explored: number }[];
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [building, setBuilding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<"brief" | "standard" | "deep">("standard");
  const [mode, setMode] = useState<"deck" | "explore">("deck");
  const [pacing, setPacing] = useState<"free" | "daily">("free");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Decks still building when the page rendered: poll their status so the
  // list flips to ready/failed without the user refreshing or opening them.
  // Stalled runs (builder died without writing "error") are excluded — their
  // status can't change until the user retries, so polling them is noise.
  // Only decks that can still change on their own. The old filter polled
  // anything with no cards that hadn't errored, which included decks that had
  // finished empty — those never change, so it polled them every 3s forever.
  const generatingIds = decks
    .filter((d) => isPollable(deckDisplayState(d)))
    .map((d) => d.id)
    .join(",");
  useEffect(() => {
    if (!generatingIds) return;
    const ids = generatingIds.split(",");
    const timer = setInterval(async () => {
      try {
        const rs = await Promise.all(ids.map((id) => getDeckStatusAction(id)));
        // A deck that finished (has cards) or failed changes the server list —
        // re-render it. Still-generating decks keep polling.
        if (rs.some((r) => r.ok && (r.cardCount > 0 || r.status === "error"))) {
          router.refresh();
        }
      } catch {
        // transient poll failure — next tick retries
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [generatingIds, router]);

  /** Route a topic into whichever mode is selected. */
  function start(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (mode === "explore") {
      // Explore needs no server round-trip to begin — the Discover screen does
      // its own work, so the tap navigates immediately.
      router.push(`/thinktank/explore/${encodeURIComponent(trimmed)}`);
      return;
    }
    void build(trimmed);
  }

  // Fast: inserts a "generating" deck and routes to it; the deck page kicks
  // the background build and polls, so nothing here waits on the AI.
  async function build(t: string) {
    const trimmed = t.trim();
    if (!trimmed || building) return;
    setBuilding(true);
    try {
      const r = await createThinkTankDeckAction(trimmed, detail, pacing);
      if (r.ok) {
        setTopic("");
        router.push(`/thinktank/${r.deckId}`);
      } else {
        toast.error(r.error);
        // The action can outlive the client fetch (web search + AI is ~20-30s).
        // If the deck was actually created but the response was lost, a refresh
        // reveals it instead of leaving the user staring at an error.
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the deck");
      router.refresh();
    } finally {
      setBuilding(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const r = await deleteDeckAction(id);
      if (!r.ok) toast.error(r.error ?? "Couldn't delete the deck");
      else router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  // Retry a failed deck in place: re-kick the background builder. The builder
  // flips the deck back to "generating" server-side, so the refresh below
  // hands it to the generating-poll effect above.
  function retry(id: string) {
    if (retryingId) return;
    setRetryingId(id);
    fetch("/api/thinktank/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deckId: id }),
    })
      .then(async (res) => {
        if (!res.ok) {
          // Show the server's actual reason (AI not configured, model error…)
          // — a generic message hides what the user could actually fix.
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(body?.error || "Couldn't rebuild the deck — try again");
        }
        router.refresh();
      })
      .catch(() => {
        // Severed long response — the deck likely still built; reveal it.
        router.refresh();
      })
      .finally(() => setRetryingId(null));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <header className="editorial-rule mb-8 pb-4">
          <div className="editorial-eyebrow mb-2">Learn · Bite-sized</div>
          <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}>
            ThinkTank
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "deck"
              ? "Pick any topic — the AI builds a deck of bite-sized idea cards, woven together with what's already in your library."
              : "Pick any topic — see what you don't know yet, then follow it wherever it leads."}
          </p>
        </header>

        <div className="relative rounded-xl border border-border bg-card p-4">
          {/* Two genuinely different shapes of learning, so they get a explicit
              choice rather than one being hidden behind the other: a deck is a
              bounded course you finish, Explore is a graph you wander. */}
          <div className="mb-3 flex items-center rounded-md border border-border p-0.5 text-xs">
            {([
              { id: "deck", label: "Build a deck", hint: "An ordered course you can finish" },
              { id: "explore", label: "Explore", hint: "Follow your curiosity, card by card" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={building}
                onClick={() => setMode(opt.id)}
                title={opt.hint}
                className={cn(
                  "flex-1 rounded px-2.5 py-1.5 transition-colors",
                  mode === opt.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start(topic)}
              placeholder="e.g. Stoicism, compound interest, how LLMs work…"
              disabled={building}
            />
            <LoadingButton
              variant="brand"
              loading={building && mode === "deck"}
              disabled={!topic.trim()}
              onClick={() => start(topic)}
              className="gap-1.5"
            >
              {!building && (mode === "deck" ? <Lightbulb className="h-4 w-4" /> : <Compass className="h-4 w-4" />)}
              {mode === "deck" ? "Build deck" : "Explore"}
            </LoadingButton>
          </div>
          {/* Detail selector — controls how deep the deck goes (card count +
              per-card word ceiling). Deeper = more tokens, richer cards.
              Meaningless in Explore, where every card is one concept. */}
          <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-2", mode === "explore" && "hidden")}>
            <div className="flex items-center gap-1.5">
              <span className="editorial-eyebrow shrink-0">Depth</span>
              <div className="flex items-center rounded-md border border-border p-0.5">
                {([
                  { id: "brief", label: "Brief", hint: "6-8 cards · ≤50 words each" },
                  { id: "standard", label: "Standard", hint: "8-12 cards · ≤80 words each" },
                  { id: "deep", label: "Deep", hint: "12-16 cards · ≤140 words each" },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={building}
                    onClick={() => setDetail(opt.id)}
                    title={opt.hint}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs transition-colors",
                      detail === opt.id
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Pacing selector — "daily" drips DAILY_CARDS cards per day so a
                deck becomes a habit instead of a one-sitting read. */}
            <div className="flex items-center gap-1.5">
              <span className="editorial-eyebrow shrink-0">Pace</span>
              <div className="flex items-center rounded-md border border-border p-0.5">
                {([
                  { id: "free", label: "All at once", hint: "Read the whole deck whenever" },
                  { id: "daily", label: "Daily", hint: `${DAILY_CARDS} new cards unlock each day` },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={building}
                    onClick={() => setPacing(opt.id)}
                    title={opt.hint}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs transition-colors",
                      pacing === opt.id
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => build(s)}
                  disabled={building}
                  className="max-w-full truncate rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Due refreshers lead the page when there are any: this is the habit
            loop for Explore, which otherwise has no completion signal to bring
            anyone back. */}
        {refreshers.length > 0 && (
          <div className="mt-8">
            <h2 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ready for a refresher
            </h2>
            <div className="flex flex-wrap gap-2">
              {refreshers.map((r) => (
                <Link
                  key={r.slug}
                  href={`/thinktank/c/${r.slug}${r.topic ? `?topic=${encodeURIComponent(r.topic)}` : ""}&refresher=1`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/5 px-3 py-1.5 text-sm transition-colors hover:bg-brand/10"
                >
                  <Sparkles className="h-3.5 w-3.5 text-brand" />
                  {r.name}
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Two minutes each — you saved these, so we brought them back.
            </p>
          </div>
        )}

        {exploredTopics.length > 0 && (
          <div className="mt-8">
            <h2 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Topics you&apos;re exploring
            </h2>
            <div className="flex flex-wrap gap-2">
              {exploredTopics.map((t) => (
                <Link
                  key={t.topic}
                  href={`/thinktank/explore/${encodeURIComponent(t.topic)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-brand/50 hover:bg-accent"
                >
                  <Compass className="h-3.5 w-3.5 text-muted-foreground" />
                  {t.topic}
                  <span className="text-xs text-muted-foreground">{t.explored}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your decks
          </h2>
          {decks.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No decks yet — type a topic above, or tap a suggestion, and start learning.
            </p>
          ) : (
            <div className="space-y-3">
              {decks.map((d) => {
                const finished = d.cardCount > 0 && d.lastPosition >= d.cardCount - 1;
                const progress = d.cardCount > 0 ? Math.min(d.lastPosition + 1, d.cardCount) : 0;
                // One total state rather than two overlapping booleans — see
                // deckDisplayState. "stalled" is a builder that died without
                // writing error; "empty" is a run that finished and produced
                // nothing. Both are retryable, neither is a spinner.
                const state = deckDisplayState(d);
                const failed = state === "stalled" || state === "failed" || state === "empty";
                // A filling deck is readable AND still growing — it shows its
                // cards plus a quiet "writing…", never a bare spinner.
                const filling = state === "filling";
                const retrying = retryingId === d.id;
                return (
                  <div
                    key={d.id}
                    className="group relative rounded-lg border border-border transition-colors hover:bg-accent/50"
                  >
                    <Link href={`/thinktank/${d.id}`} className="block p-4 pr-12">
                      <div className="text-sm font-semibold">{d.title}</div>
                      {d.description && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.description}</div>
                      )}
                      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {state !== "ready" && !filling ? (
                          failed && !retrying ? (
                            <span className="text-destructive">
                              {state === "stalled"
                                ? "Stalled"
                                : state === "empty"
                                  ? "Empty — retry"
                                  : "Failed"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Spinner className="h-3 w-3" /> Building…
                            </span>
                          )
                        ) : (
                          <>
                            <span>{d.cardCount} cards</span>
                            <span>·</span>
                            <span>{DETAIL_LABEL[d.detail]}</span>
                            {d.pacing === "daily" && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1">
                                  <CalendarClock className="h-3 w-3" /> Daily
                                </span>
                              </>
                            )}
                            <span>·</span>
                            <span className={cn(finished && !filling && "text-brand")}>
                              {finished && !filling ? "Finished" : `Card ${progress} of ${d.cardCount}`}
                            </span>
                            {filling && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1 text-brand">
                                  <Spinner className="h-3 w-3" /> writing
                                </span>
                              </>
                            )}
                          </>
                        )}
                        {failed && !retrying && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              retry(d.id);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 uppercase tracking-wide transition-colors hover:text-foreground"
                          >
                            <RefreshCw className="h-3 w-3" /> Retry
                          </button>
                        )}
                        <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </Link>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-2 top-2 h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={`Delete deck ${d.title}`}
                      disabled={deletingId === d.id}
                      onClick={() => remove(d.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

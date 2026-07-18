"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lightbulb, Trash2 } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { BusyOverlay } from "@/components/ui/busy-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createThinkTankDeckAction, deleteDeckAction } from "@/app/(app)/thinktank/actions";

export type DeckSummary = {
  id: string;
  topic: string;
  title: string;
  description: string | null;
  status: "generating" | "ready" | "error";
  lastPosition: number;
  createdAt: string;
  cardCount: number;
};

/**
 * ThinkTank hub: type any topic (or tap a suggestion seeded from your
 * interests + tags) and the AI builds a swipeable deck of idea cards.
 */
export function ThinkTankHub({
  decks,
  suggestions,
}: {
  decks: DeckSummary[];
  suggestions: string[];
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [building, setBuilding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<"brief" | "standard" | "deep">("standard");

  async function build(t: string) {
    const trimmed = t.trim();
    if (!trimmed || building) return;
    setBuilding(true);
    try {
      const r = await createThinkTankDeckAction(trimmed, detail);
      if (r.ok) {
        setTopic("");
        router.push(`/thinktank/${r.deckId}`);
        router.refresh();
      } else {
        toast.error(r.error);
        // The action can outlive the client fetch (web search + AI is ~20-30s).
        // If the deck was actually created but the response was lost, a refresh
        // reveals it instead of leaving the user staring at an error.
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the deck");
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <header className="editorial-rule mb-8 pb-4">
          <div className="editorial-eyebrow mb-2">Learn · Bite-sized</div>
          <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}>
            ThinkTank
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick any topic — the AI builds a deck of bite-sized idea cards, woven together with
            what&apos;s already in your library.
          </p>
        </header>

        <div className="relative rounded-xl border border-border bg-card p-4">
          <BusyOverlay show={building} label="Building your deck… ~20s" />
          <div className="flex gap-2">
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && build(topic)}
              placeholder="e.g. Stoicism, compound interest, how LLMs work…"
              disabled={building}
            />
            <LoadingButton variant="brand" loading={building} disabled={!topic.trim()} onClick={() => build(topic)} className="gap-1.5">
              {!building && <Lightbulb className="h-4 w-4" />}
              Build deck
            </LoadingButton>
          </div>
          {/* Detail selector — controls how deep the deck goes (card count +
              per-card word ceiling). Deeper = more tokens, richer cards. */}
          <div className="mt-3 flex items-center gap-1.5">
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
          {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => build(s)}
                  disabled={building}
                  className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

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
                        <span>{d.cardCount} cards</span>
                        <span>·</span>
                        <span className={cn(finished && "text-brand")}>
                          {finished ? "Finished" : `Card ${progress} of ${d.cardCount}`}
                        </span>
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

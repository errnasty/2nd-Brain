"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Rabbit,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isSeveredResponse } from "@/lib/ui/severed";
import { runBackgroundJob } from "@/lib/ui/background-job";
import type { ThinkTankCard, ThinkTankDeck } from "@/lib/db/schema";
import {
  makeFlashcardsFromCardAction,
  saveCardToLibraryAction,
  setDeckPositionAction,
} from "@/app/(app)/thinktank/actions";

const SECTION_LABEL: Record<ThinkTankCard["section"], string> = {
  prerequisites: "Prerequisites",
  core: "Core ideas",
  advanced: "Going deeper",
};

/**
 * Swipeable idea-card reader: CSS scroll-snap gives native horizontal swipe on
 * mobile (no animation library); arrows/keys drive it on desktop. The visible
 * card index is observed and persisted as the deck's resume position.
 */
export function CardReader({ deck, cards }: { deck: ThinkTankDeck; cards: ThinkTankCard[] }) {
  const router = useRouter();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(Math.min(deck.lastPosition, Math.max(0, cards.length - 1)));
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(cards.filter((c) => c.savedItemId).map((c) => c.id)),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cardingId, setCardingId] = useState<string | null>(null);
  const [buildingCurriculum, setBuildingCurriculum] = useState(false);

  // Total slides = cards + the finish card.
  const total = cards.length + 1;

  // Jump to the resume position once on mount (instant, not smooth).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || deck.lastPosition <= 0) return;
    const child = track.children[Math.min(deck.lastPosition, total - 1)] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Observe which slide is visible → update index + debounce-persist it.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          if (Number.isNaN(i)) continue;
          setIndex(i);
          clearTimeout(timer);
          timer = setTimeout(() => {
            void setDeckPositionAction(deck.id, Math.min(i, cards.length - 1));
          }, 600);
        }
      },
      { root: track, threshold: 0.6 },
    );
    for (const child of Array.from(track.children)) io.observe(child);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [deck.id, cards.length]);

  function goTo(i: number) {
    const track = trackRef.current;
    const child = track?.children[Math.max(0, Math.min(total - 1, i))] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  // Arrow-key navigation on desktop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function saveCard(card: ThinkTankCard) {
    setSavingId(card.id);
    try {
      const r = await saveCardToLibraryAction(card.id);
      if (r.ok) {
        setSavedIds((prev) => new Set(prev).add(card.id));
        toast.success(r.alreadySaved ? "Already in your Directory" : "Saved to your Directory", {
          action: { label: "Open", onClick: () => router.push(`/directory?item=${r.itemId}`) },
        });
      } else {
        toast.error(r.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the card");
    } finally {
      setSavingId(null);
    }
  }

  async function makeCards(card: ThinkTankCard) {
    setCardingId(card.id);
    try {
      const r = await makeFlashcardsFromCardAction(card.id);
      if (r.ok) toast.success(`${r.count} flashcards added to Study`);
      else toast.error(r.error);
    } catch (err) {
      // A severed long response (serverless timeout) isn't a failure — the
      // generation finishes server-side. Say so instead of alarming the user.
      if (isSeveredResponse(err)) {
        toast.message("Still working in the background — your flashcards will appear in Study shortly.");
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't make flashcards");
      }
    } finally {
      setCardingId(null);
    }
  }

  // Finish card: build a full curriculum note for the deck's topic, as a
  // background job (create → kick → poll) so the long AI call can't surface
  // a false error.
  function buildCurriculum() {
    if (buildingCurriculum) return;
    setBuildingCurriculum(true);
    void runBackgroundJob({
      kind: "curriculum",
      topic: deck.topic,
      onDone: (itemId) => {
        setBuildingCurriculum(false);
        toast.success("Curriculum saved to your Directory");
        router.push(`/directory?item=${itemId}`);
      },
      onError: (message) => {
        setBuildingCurriculum(false);
        toast.error(message);
      },
      onStillWorking: () => {
        setBuildingCurriculum(false);
        toast.message("Still building — the curriculum note will appear in your Directory shortly.");
      },
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Link
          href="/thinktank"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to ThinkTank"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{deck.title}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {index < cards.length ? `Card ${index + 1} of ${cards.length}` : "Finished"}
            {deck.model && <span className="ml-2 opacity-60">· {deck.model}</span>}
            {deck.tokenCount != null && <span className="ml-2 opacity-60">· {deck.tokenCount.toLocaleString()} tok</span>}
          </div>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous card">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => goTo(index + 1)} disabled={index >= total - 1} aria-label="Next card">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Swipe track */}
      <div
        ref={trackRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth"
      >
        {cards.map((card, i) => (
          <section
            key={card.id}
            data-index={i}
            className="flex w-full shrink-0 snap-start justify-center overflow-y-auto px-6 py-8"
          >
            <div className="w-full max-w-xl">
              <div className="editorial-eyebrow-brand">§ {SECTION_LABEL[card.section]}</div>
              <h2 className="editorial-display mt-3 text-2xl" style={{ letterSpacing: "-0.018em" }}>
                {card.title}
              </h2>
              <div className="prose prose-sm mt-4 max-w-none leading-relaxed dark:prose-invert">
                <Markdown>{card.body}</Markdown>
              </div>

              {card.sourceRefs.length > 0 && (
                <div className="mt-5 rounded-lg border border-border bg-card p-3">
                  <div className="pb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Sources
                  </div>
                  {card.sourceRefs.map((r) =>
                    r.itemId ? (
                      <Link
                        key={`${card.id}-${r.itemId}`}
                        href={`/directory?item=${r.itemId}`}
                        className="block truncate py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {r.title} <span className="opacity-60">· your library</span>
                      </Link>
                    ) : r.url ? (
                      <a
                        key={`${card.id}-${r.url}`}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {r.title} <span className="opacity-60">· web</span>
                      </a>
                    ) : (
                      <div key={`${card.id}-${r.title}`} className="truncate py-0.5 text-xs text-muted-foreground">
                        {r.title}
                      </div>
                    ),
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <LoadingButton
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  loading={savingId === card.id}
                  disabled={savedIds.has(card.id)}
                  onClick={() => saveCard(card)}
                >
                  {savingId !== card.id &&
                    (savedIds.has(card.id) ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />)}
                  {savedIds.has(card.id) ? "Saved" : "Save to library"}
                </LoadingButton>
                <LoadingButton
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  loading={cardingId === card.id}
                  onClick={() => makeCards(card)}
                >
                  {cardingId !== card.id && <GraduationCap className="h-3.5 w-3.5" />}
                  Make flashcards
                </LoadingButton>
                <Button size="sm" variant="ghost" className="gap-1.5" asChild>
                  <Link href="/rabbithole">
                    <Rabbit className="h-3.5 w-3.5" />
                    Go deeper
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        ))}

        {/* Finish card */}
        <section
          data-index={cards.length}
          className="flex w-full shrink-0 snap-start items-center justify-center overflow-y-auto px-6 py-8"
        >
          <div className="w-full max-w-xl text-center">
            <Sparkles className="mx-auto h-8 w-8" style={{ color: "hsl(var(--brand))" }} />
            <h2 className="editorial-display mt-4 text-2xl" style={{ letterSpacing: "-0.018em" }}>
              You finished “{deck.topic}”.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Keep going: turn this into a full learning path in your Directory, or restart the deck.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <LoadingButton variant="brand" size="sm" className="gap-1.5" loading={buildingCurriculum} onClick={buildCurriculum}>
                {!buildingCurriculum && <GraduationCap className="h-3.5 w-3.5" />}
                Build full curriculum
              </LoadingButton>
              <Button size="sm" variant="outline" onClick={() => goTo(0)}>
                Start over
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/thinktank">All decks</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 border-t border-border py-2.5">
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={i < cards.length ? `Go to card ${i + 1}` : "Go to the finish card"}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-5" : "w-1.5 bg-border hover:bg-muted-foreground/40",
            )}
            style={i === index ? { background: "hsl(var(--brand))" } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

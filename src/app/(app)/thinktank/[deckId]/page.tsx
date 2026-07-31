import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { deckDisplayState } from "@/lib/thinktank/stall";
import { CardReader } from "@/components/thinktank/card-reader";
import { DeckGenerating } from "@/components/thinktank/deck-generating";

export const dynamic = "force-dynamic";

type Params = Promise<{ deckId: string }>;

export default async function ThinkTankDeckPage({ params }: { params: Params }) {
  const { deckId } = await params;
  const { user } = await requireUser();

  // Both filter by the deckId from the URL, so they can run in parallel; the
  // ownership check on the deck row gates rendering either way.
  const [[deck], cards] = await Promise.all([
    db
      .select()
      .from(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
      .limit(1),
    db
      .select()
      .from(thinktankCards)
      .where(and(eq(thinktankCards.deckId, deckId), eq(thinktankCards.userId, user.id)))
      .orderBy(asc(thinktankCards.position)),
  ]);
  if (!deck) notFound();

  // No cards yet: generation is in flight, dead, or finished empty.
  if (cards.length === 0) {
    // Anything that isn't a live build gets the retry affordance, not a
    // spinner. `status === "error"` alone missed two states that can't
    // resolve on their own: a builder that died without writing error, and a
    // run that completed but wrote no cards — both used to poll forever here.
    const state = deckDisplayState({
      cardCount: 0,
      status: deck.status,
      updatedAt: deck.updatedAt,
    });
    return (
      <DeckGenerating
        deckId={deck.id}
        topic={deck.topic}
        failed={state !== "building"}
        startedAt={deck.updatedAt.toISOString()}
      />
    );
  }

  return <CardReader deck={deck} cards={cards} />;
}

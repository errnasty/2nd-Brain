import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
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

  // No cards yet: generation is in flight (or failed) — render the poller.
  if (cards.length === 0) {
    return <DeckGenerating deckId={deck.id} topic={deck.topic} failed={deck.status === "error"} />;
  }

  return <CardReader deck={deck} cards={cards} />;
}

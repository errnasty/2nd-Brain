import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { CardReader } from "@/components/thinktank/card-reader";

export const dynamic = "force-dynamic";

type Params = Promise<{ deckId: string }>;

export default async function ThinkTankDeckPage({ params }: { params: Params }) {
  const { deckId } = await params;
  const { user } = await requireUser();

  const [deck] = await db
    .select()
    .from(thinktankDecks)
    .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
    .limit(1);
  if (!deck) notFound();

  const cards = await db
    .select()
    .from(thinktankCards)
    .where(eq(thinktankCards.deckId, deck.id))
    .orderBy(asc(thinktankCards.position));

  return <CardReader deck={deck} cards={cards} />;
}

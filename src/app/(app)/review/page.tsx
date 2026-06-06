import { requireUser } from "@/lib/auth";
import { fetchDueCards, fetchCardStats, type DueCard } from "./actions";
import { ReviewView } from "@/components/review/review-view";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { user } = await requireUser();
  let cards: DueCard[] = [];
  let total = 0;
  try {
    [cards, { total }] = await Promise.all([
      fetchDueCards(user.id),
      fetchCardStats(user.id),
    ]);
  } catch (err) {
    console.error("ReviewPage fetch failed:", err instanceof Error ? err.message : err);
  }
  return <ReviewView cards={cards} total={total} />;
}

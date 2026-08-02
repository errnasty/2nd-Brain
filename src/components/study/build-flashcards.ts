import { generateFlashcardsAction } from "@/app/(app)/review/actions";
import { withGenerationJob } from "@/lib/ui/generation-jobs";

/**
 * Make flashcards for one item, with the work visible in the app's generation
 * strip for its whole duration.
 *
 * Unlike the quiz, this is a single model call, so there is nothing to count:
 * the job is registered without a total and the strip shows an indeterminate
 * bar. It is wrapped anyway because it takes just as long from the user's side,
 * and it is started from the same menus — which close, and navigate, leaving
 * the button's spinner nowhere to be seen.
 */
export function buildFlashcards(
  itemId: string,
): ReturnType<typeof generateFlashcardsAction> {
  return withGenerationJob("Making flashcards", () => generateFlashcardsAction(itemId));
}

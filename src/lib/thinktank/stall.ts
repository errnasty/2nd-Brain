/**
 * Stall detection for deck generation. runDeckGeneration stamps
 * status="generating" + updatedAt when a run starts; a deck still
 * "generating" with no cards and a stamp older than this is a run that died
 * without writing "error" (serverless timeout, killed instance). Client-safe
 * pure date math, shared by the hub list and the deck page poller.
 */
export const GENERATION_STALL_MS = 3 * 60 * 1000;

/**
 * Whether a generation run should be treated as dead.
 *
 * An unparseable timestamp counts as STALLED, not as fresh. That direction is
 * deliberate and it is the whole reason this function validates at all: the
 * previous version did `now - new Date(x).getTime() > LIMIT`, which for an
 * Invalid Date evaluates `NaN > LIMIT` — false. So a date the browser couldn't
 * read reported "still going", and the deck sat on a spinner that could never
 * resolve, polling every three seconds forever.
 *
 * Between "offer a retry on a deck that was actually fine" and "spin forever
 * on a deck that is dead", the retry is the recoverable mistake.
 */
export function isStalledGeneration(startedAt: string | Date, now = Date.now()): boolean {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return true;
  return now - started > GENERATION_STALL_MS;
}

/**
 * What a deck in the list should actually say.
 *
 * Exists because the previous logic asked two independent questions ("is it
 * stalled?", "did it error?") and left a gap between them: a deck with zero
 * cards whose status was neither "generating" nor "error" matched neither, and
 * fell through to the default — an eternal "Building…". A deck that finished
 * as `ready` but wrote no cards landed exactly there.
 *
 * So this is a total function instead: every combination of card count, status
 * and age maps to one of four states, and the caller renders a branch per
 * state. Adding a status to the enum now forces a decision here rather than
 * silently producing a spinner.
 */
export type DeckDisplayState =
  | "building"
  | "filling"
  | "stalled"
  | "failed"
  | "empty"
  | "ready";

export function deckDisplayState(
  deck: { cardCount: number; status: string; updatedAt: string | Date },
  now = Date.now(),
): DeckDisplayState {
  // An errored deck that nonetheless has cards is readable, and labelling it
  // "Failed" would hide content the user can use. The stepped builder only
  // writes "error" when nothing at all landed, so this case is legacy rows.
  if (deck.status === "error") return deck.cardCount > 0 ? "ready" : "failed";

  if (deck.status === "generating") {
    // A stepped build writes cards as it goes, so "generating" and "has cards"
    // are no longer contradictory — that combination is a deck you can already
    // start reading while the rest is still being written.
    if (isStalledGeneration(deck.updatedAt, now)) return "stalled";
    return deck.cardCount > 0 ? "filling" : "building";
  }

  if (deck.cardCount > 0) return "ready";

  // Not generating, not errored, yet nothing to show: the run finished and
  // produced nothing. Retryable, and never a spinner.
  return "empty";
}

/** Whether this state can still change on its own, i.e. is worth polling. */
export function isPollable(state: DeckDisplayState): boolean {
  return state === "building" || state === "filling";
}

/** Whether the deck has enough content to open and read. */
export function isReadable(state: DeckDisplayState): boolean {
  return state === "ready" || state === "filling";
}

/**
 * Stall detection for deck generation. runDeckGeneration stamps
 * status="generating" + updatedAt when a run starts; a deck still
 * "generating" with no cards and a stamp older than this is a run that died
 * without writing "error" (serverless timeout, killed instance). Client-safe
 * pure date math, shared by the hub list and the deck page poller.
 */
export const GENERATION_STALL_MS = 3 * 60 * 1000;

export function isStalledGeneration(startedAt: string | Date, now = Date.now()): boolean {
  return now - new Date(startedAt).getTime() > GENERATION_STALL_MS;
}

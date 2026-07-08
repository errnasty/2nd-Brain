// Client-safe stream sentinel handling. Route modules keep their own copies (a
// Next route file can't export arbitrary consts), but every client stream reader
// shares this so a sentinel split across two network chunks (e.g. "<<<SB_USA")
// never flashes as raw text for a frame before the rest arrives.

export const USAGE_SENTINEL = "<<<SB_USAGE:";
export const WEBSOURCES_SENTINEL = "<<<SB_WEBSOURCES:";
export const BRIEFSOURCES_SENTINEL = "<<<SB_BRIEFSOURCES:";
export const RABBITHOLE_SENTINEL = "<<<SB_RH_NODE:";

const ALL = [USAGE_SENTINEL, WEBSOURCES_SENTINEL, BRIEFSOURCES_SENTINEL, RABBITHOLE_SENTINEL];

/** Index of the first complete sentinel marker in `acc`, or -1. */
export function firstSentinel(acc: string): number {
  let min = -1;
  for (const s of ALL) {
    const i = acc.indexOf(s);
    if (i >= 0 && (min < 0 || i < min)) min = i;
  }
  return min;
}

/** Length of a trailing PARTIAL sentinel prefix at the end of `acc` (0 if none). */
function trailingPartial(acc: string): number {
  let best = 0;
  for (const s of ALL) {
    const max = Math.min(s.length - 1, acc.length);
    for (let k = max; k > best; k -= 1) {
      if (acc.endsWith(s.slice(0, k))) {
        best = k;
        break;
      }
    }
  }
  return best;
}

/**
 * The text safe to render: cut at the first complete sentinel, AND hide a
 * trailing partial sentinel prefix so a marker split across chunks never flashes.
 */
export function displayText(acc: string): string {
  const cut = firstSentinel(acc);
  if (cut >= 0) return acc.slice(0, cut);
  const tail = trailingPartial(acc);
  return tail > 0 ? acc.slice(0, acc.length - tail) : acc;
}

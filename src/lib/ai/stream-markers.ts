// Client-safe stream sentinel handling. Route modules keep their own copies (a
// Next route file can't export arbitrary consts), but every client stream reader
// shares this so a sentinel split across two network chunks (e.g. "<<<SB_USA")
// never flashes as raw text for a frame before the rest arrives.

export const USAGE_SENTINEL = "<<<SB_USAGE:";
export const WEBSOURCES_SENTINEL = "<<<SB_WEBSOURCES:";
export const BRIEFSOURCES_SENTINEL = "<<<SB_BRIEFSOURCES:";
export const RABBITHOLE_SENTINEL = "<<<SB_RH_NODE:";

// Trailing sentinels: each appears at most once, and everything from its first
// occurrence to the end of the stream is that sentinel's payload (never
// rendered). Fine for markers that only ever show up once the answer is done.
const ALL = [USAGE_SENTINEL, WEBSOURCES_SENTINEL, BRIEFSOURCES_SENTINEL, RABBITHOLE_SENTINEL];

// Inline sentinels: self-terminated frames (sentinel + base64 payload + END)
// that can appear multiple times, interleaved with real answer text — status
// updates, the rag-source list, and streamed thinking deltas all arrive before
// (or between) chunks of the actual answer, so they can't use the "cut to EOF"
// model above. Use `extractFrames` to pull these out before calling `displayText`.
export const RAGSOURCES_SENTINEL = "<<<SB_RAGSOURCES:";
export const STATUS_SENTINEL = "<<<SB_STATUS:";
export const THINKING_SENTINEL = "<<<SB_THINKING:";
export const FRAME_END = ":SB_END>>>";

function trailingPartialOf(s: string, sentinel: string): number {
  const max = Math.min(sentinel.length - 1, s.length);
  for (let k = max; k > 0; k -= 1) {
    if (s.endsWith(sentinel.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Pull every COMPLETE `sentinel…FRAME_END` frame out of `acc`, in order,
 * returning their (still base64-encoded) payloads plus `acc` with those frames
 * removed. A frame whose opener has arrived but not its closer — including a
 * partial opener split across chunk boundaries — is left out of `rest`
 * entirely (never shown as raw text) and picked back up once the rest of it
 * streams in on a later call over the same growing `acc`.
 */
export function extractFrames(acc: string, sentinel: string): { payloads: string[]; rest: string } {
  const payloads: string[] = [];
  let rest = "";
  let i = 0;
  while (true) {
    const start = acc.indexOf(sentinel, i);
    if (start < 0) {
      const tail = acc.slice(i);
      const partial = trailingPartialOf(tail, sentinel);
      rest += partial > 0 ? tail.slice(0, tail.length - partial) : tail;
      break;
    }
    rest += acc.slice(i, start);
    const end = acc.indexOf(FRAME_END, start + sentinel.length);
    if (end < 0) break; // opened but not yet closed — wait for more bytes
    payloads.push(acc.slice(start + sentinel.length, end));
    i = end + FRAME_END.length;
  }
  return { payloads, rest };
}

/** Decode + JSON.parse one frame payload (base64 of a UTF-8 JSON string). */
export function decodeFramePayload<T = unknown>(payload: string): T {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as T;
}

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

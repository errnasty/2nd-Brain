/**
 * Strip inline `<think>…</think>` reasoning out of a streamed answer.
 *
 * A reasoning model's thinking normally arrives on its own channel (Anthropic's
 * thinking blocks, OpenRouter's `delta.reasoning`) and never reaches the answer
 * text. But several OpenRouter routes — DeepSeek-family ones especially — fall
 * back to emitting the thinking INLINE, wrapped in `<think>` tags, as ordinary
 * content. Rendered as-is that turns a Daily Brief section into a page of the
 * model talking to itself, or, when the output cap lands mid-thought, into a
 * lone unterminated `<think>` and nothing else.
 *
 * Stripping happens on the stream rather than at the end because the text is
 * rendered as it arrives: by the time a closing tag proves a passage was
 * thinking, the user would already have watched it appear.
 */

// Both spellings are in the wild; `<think>` from DeepSeek-family routes,
// `<thinking>` from models imitating Anthropic's block name.
const TAGS = ["think", "thinking"] as const;
const OPENERS = TAGS.map((t) => `<${t}>`);
const CLOSERS = TAGS.map((t) => `</${t}>`);

/** Length of the longest suffix of `s` that is a proper prefix of `needle`. */
function trailingPartial(s: string, needle: string): number {
  const max = Math.min(needle.length - 1, s.length);
  for (let k = max; k > 0; k -= 1) {
    if (s.endsWith(needle.slice(0, k))) return k;
  }
  return 0;
}

/** Earliest occurrence of any `needles` entry in `s`, or null. */
function firstOf(s: string, needles: readonly string[]): { at: number; needle: string } | null {
  let best: { at: number; needle: string } | null = null;
  for (const needle of needles) {
    const at = s.indexOf(needle);
    if (at >= 0 && (best === null || at < best.at)) best = { at, needle };
  }
  return best;
}

export type ThinkStripper = {
  /** Visible text from this delta — may be empty while inside a think block,
   *  or while a tag is still arriving split across chunk boundaries. */
  push(delta: string): string;
  /** Any text still held back once the stream ends. Text inside an unclosed
   *  think block is dropped: the model was cut off mid-thought and never
   *  reached the answer, so there is nothing to show. */
  flush(): string;
};

/** A stateful filter that removes think blocks from a stream of text deltas. */
export function createThinkStripper(): ThinkStripper {
  // Held-back text: either the tail of a possible tag, or the inside of an
  // open think block (kept only far enough to spot the closing tag).
  let buf = "";
  let inside = false;

  return {
    push(delta: string): string {
      buf += delta;
      let out = "";
      for (;;) {
        if (inside) {
          const close = firstOf(buf, CLOSERS);
          if (!close) {
            // Still thinking. Discard all but a possible partial closer, so a
            // long thinking pass doesn't accumulate in memory.
            const keep = Math.max(...CLOSERS.map((c) => trailingPartial(buf, c)));
            buf = keep > 0 ? buf.slice(buf.length - keep) : "";
            return out;
          }
          buf = buf.slice(close.at + close.needle.length);
          inside = false;
          continue;
        }
        const open = firstOf(buf, OPENERS);
        if (!open) {
          const keep = Math.max(...OPENERS.map((o) => trailingPartial(buf, o)));
          out += keep > 0 ? buf.slice(0, buf.length - keep) : buf;
          buf = keep > 0 ? buf.slice(buf.length - keep) : "";
          return out;
        }
        out += buf.slice(0, open.at);
        buf = buf.slice(open.at + open.needle.length);
        inside = true;
      }
    },

    flush(): string {
      if (inside) return "";
      const rest = buf;
      buf = "";
      return rest;
    },
  };
}

/** One-shot convenience for non-streamed text. */
export function stripThinkTags(text: string): string {
  const s = createThinkStripper();
  return s.push(text) + s.flush();
}

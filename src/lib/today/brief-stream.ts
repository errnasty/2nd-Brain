/**
 * Response-body assembly for the Daily Brief's streamed generations.
 *
 * Lives here rather than in the route because a Next.js route module can only
 * export its handlers — and because this is the part of the brief with real
 * failure modes worth testing: a retry that fires only when a generation comes
 * back empty, usage that has to be billed exactly once across both attempts,
 * and text filtering that runs mid-stream. All three are invisible on the happy
 * path and expensive to get wrong.
 */

import { createThinkStripper } from "@/lib/ai/think-tags";
import type { BriefSourceRef } from "@/lib/db/schema";

// Trailing markers appended after the text. The client splits on these and
// never renders them. Sources go in the body (not a header) because a
// 60-article map can exceed proxy header-size caps. Mirrors /api/ask.
export const BRIEFSOURCES_SENTINEL = "<<<SB_BRIEFSOURCES:";
export const USAGE_SENTINEL = "<<<SB_USAGE:";

export type BriefUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

/**
 * The slice of the AI SDK's `streamText` result this module needs.
 *
 * Structural on purpose: `streamText`'s own return type satisfies it, and a
 * test can hand over a plain object instead of standing up a model provider.
 */
export type TextGeneration = {
  textStream: AsyncIterable<string>;
  usage: Promise<
    { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  >;
};

/**
 * How long to wait for a generation to report its token usage before giving up
 * on billing it.
 *
 * On the success path this promise has already settled, so the wait is
 * theoretical. It exists for the failure path: awaiting usage after a severed
 * stream is the only way to bill tokens that were genuinely burned, but a
 * provider that never settles it would otherwise hold the response open until
 * the edge times it out — which on Railway means up to 15 minutes of a request
 * doing nothing.
 */
export const USAGE_SETTLE_MS = 2_000;

/** Await `p`, resolving to `undefined` if it rejects or outruns `USAGE_SETTLE_MS`. */
function settleWithin<T>(p: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), USAGE_SETTLE_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type BriefStreamOptions = {
  /** Appended as a trailing sentinel once generation finishes. */
  sourceMap?: BriefSourceRef[];
  /** Called with the final visible text — used to populate the brief cache. */
  onDone?: (content: string, usage: BriefUsage) => void;
  /** Second attempt, used only when the first produces no visible text. */
  retry?: () => TextGeneration;
  /** Records billable tokens. Called at most once per response. */
  recordUsage: (totalTokens: number) => void;
  /** Aborted when the client disconnects — suppresses the error tail. */
  signal?: { aborted: boolean };
};

/**
 * Pipe a generation's text through, then append the trailing sentinels the
 * client strips and parses. Sources and usage aren't known until generation
 * finishes, so they can't go in headers that were already sent.
 *
 * Two things happen to the text on the way out. Inline `<think>` blocks are
 * stripped (some OpenRouter routes emit reasoning as ordinary content — see
 * `think-tags.ts`), and a generation that yields no visible text at all is
 * retried once via `opts.retry`, because the usual cause is an output budget
 * spent on hidden reasoning rather than a broken request.
 */
export function briefStream(
  result: TextGeneration,
  opts: BriefStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const usageTotal: BriefUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let acc = "";
      const write = (s: string) => controller.enqueue(encoder.encode(s));

      // Billing runs on BOTH the success and the failure path — the failure one
      // exists because tokens burned before an error still cost money. A write
      // to a controller the client already closed throws, which drops the
      // success path into the catch AFTER it has billed, so without this latch
      // a mid-write disconnect charges the user twice for one generation.
      let billed = false;
      const bill = () => {
        if (billed || usageTotal.totalTokens <= 0) return;
        billed = true;
        opts.recordUsage(usageTotal.totalTokens);
      };

      /**
       * Fold one attempt's reported usage into the running total.
       *
       * A generation that failed may reject this promise, or never settle it at
       * all; `settleWithin` turns both into "no usage reported" rather than a
       * crash or a hang. Awaiting it here also keeps a rejection from surfacing
       * as an unhandled one.
       */
      const addUsage = async (p: TextGeneration["usage"]) => {
        const usage = await settleWithin(p);
        usageTotal.promptTokens += usage?.promptTokens ?? 0;
        usageTotal.completionTokens += usage?.completionTokens ?? 0;
        usageTotal.totalTokens += usage?.totalTokens ?? 0;
      };

      /**
       * Drain one attempt. Returns rather than throws, because whether a
       * failure is recoverable depends on how much it had already written.
       */
      const attempt = async (r: TextGeneration): Promise<{ text: string; error?: unknown }> => {
        const stripper = createThinkStripper();
        let produced = "";
        const show = (s: string) => {
          if (!s) return;
          produced += s;
          acc += s;
          write(s);
        };
        let error: unknown;
        try {
          for await (const delta of r.textStream) show(stripper.push(delta));
          show(stripper.flush());
        } catch (err) {
          error = err;
        } finally {
          // In `finally`, not after the loop: a stream that dies partway has
          // still produced — and still bills for — every token up to the
          // failure. Accumulating only on success under-counted usage against
          // the per-user daily budget, and a generation that reliably failed
          // mid-stream could burn tokens without ever moving the cap.
          await addUsage(r.usage);
        }
        return { text: produced, error };
      };

      try {
        let { text, error } = await attempt(result);

        // Nothing readable came back. Either the tokens went somewhere the
        // reader can't see them — a hidden reasoning pass that used up the
        // ceiling, or a think block cut off before the answer began — or the
        // request was rejected outright before writing a word. Both are worth
        // one conservative second attempt (see the route's `retry`): a bigger
        // ceiling, and none of the provider tuning that could itself be what
        // the backend refused.
        //
        // A failure that arrives AFTER some text is deliberately not retried:
        // that text is already on the reader's screen, and a second attempt
        // would append a duplicate of it.
        if (!text.trim() && opts.retry && !opts.signal?.aborted) {
          console.warn(
            "brief section produced no visible text — retrying without provider tuning",
            error instanceof Error ? error.message : "",
          );
          ({ text, error } = await attempt(opts.retry()));
        }
        if (error) throw error;

        if (opts.sourceMap) {
          write(`\n${BRIEFSOURCES_SENTINEL}${JSON.stringify(opts.sourceMap)}`);
        }
        bill();
        write(`\n${USAGE_SENTINEL}${JSON.stringify(usageTotal)}`);
        opts.onDone?.(acc, usageTotal);
      } catch (err) {
        // Tokens spent before the failure still cost money — bill them.
        bill();
        if (!opts.signal?.aborted) {
          try {
            write(`\n\n_(generation error: ${err instanceof Error ? err.message : "unknown"})_`);
          } catch {
            /* controller closed */
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

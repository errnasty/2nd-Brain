import { describe, expect, it, vi } from "vitest";
import {
  BRIEFSOURCES_SENTINEL,
  USAGE_SENTINEL,
  USAGE_SETTLE_MS,
  briefStream,
  type TextGeneration,
} from "./brief-stream";

/** A stand-in for `streamText`'s result: fixed deltas, fixed usage. */
function generation(
  deltas: string[],
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined = {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  },
): TextGeneration {
  return {
    textStream: (async function* () {
      for (const d of deltas) yield d;
    })(),
    usage: Promise.resolve(usage),
  };
}

/** A generation that throws partway through, like a severed upstream request. */
function failing(deltasBefore: string[], message: string): TextGeneration {
  return {
    textStream: (async function* () {
      for (const d of deltasBefore) yield d;
      throw new Error(message);
    })(),
    usage: Promise.resolve({ promptTokens: 4, completionTokens: 0, totalTokens: 4 }),
  };
}

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** The part the client renders — everything before the first sentinel. */
function body(payload: string): string {
  const cut = Math.min(
    ...[BRIEFSOURCES_SENTINEL, USAGE_SENTINEL]
      .map((s) => payload.indexOf(s))
      .filter((i) => i >= 0)
      .concat([payload.length]),
  );
  return payload.slice(0, cut).trim();
}

describe("briefStream", () => {
  it("streams the text and appends the usage sentinel", async () => {
    const recordUsage = vi.fn();
    const out = await read(briefStream(generation(["Lead ", "story [1]."]), { recordUsage }));

    expect(body(out)).toBe("Lead story [1].");
    expect(out).toContain(`${USAGE_SENTINEL}{"promptTokens":10,"completionTokens":5,"totalTokens":15}`);
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(15);
  });

  it("appends the source map when one is supplied", async () => {
    const sourceMap = [{ n: 1, id: "a", title: "T", url: "u", feedTitle: "F" }];
    const out = await read(
      briefStream(generation(["text"]), {
        recordUsage: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sourceMap: sourceMap as any,
      }),
    );
    expect(out).toContain(`${BRIEFSOURCES_SENTINEL}${JSON.stringify(sourceMap)}`);
  });

  it("strips inline think blocks from the rendered text", async () => {
    const out = await read(
      briefStream(generation(["<think>weigh", "ing it up</think>", "The answer [2]."]), {
        recordUsage: vi.fn(),
      }),
    );
    expect(body(out)).toBe("The answer [2].");
  });

  // The DeepSeek V4 failure: the output cap is spent on hidden reasoning, so
  // the first attempt yields nothing at all.
  describe("empty-generation retry", () => {
    it("retries once and streams the second attempt's text", async () => {
      const retry = vi.fn(() => generation(["Recovered [1]."], { totalTokens: 40 }));
      const out = await read(
        briefStream(generation([], { totalTokens: 15 }), { recordUsage: vi.fn(), retry }),
      );

      expect(retry).toHaveBeenCalledOnce();
      expect(body(out)).toBe("Recovered [1].");
    });

    it("bills both attempts as one charge", async () => {
      const recordUsage = vi.fn();
      await read(
        briefStream(generation([], { promptTokens: 10, completionTokens: 0, totalTokens: 10 }), {
          recordUsage,
          retry: () =>
            generation(["ok"], { promptTokens: 10, completionTokens: 30, totalTokens: 40 }),
        }),
      );
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(50);
    });

    // A think block that got cut off before the answer began strips to "", which
    // is just as unrenderable as no output at all.
    it("treats an unterminated think block as empty", async () => {
      const retry = vi.fn(() => generation(["Real text."]));
      const out = await read(
        briefStream(generation(["<think>still reasoning when the cap hit"]), {
          recordUsage: vi.fn(),
          retry,
        }),
      );
      expect(retry).toHaveBeenCalledOnce();
      expect(body(out)).toBe("Real text.");
    });

    it("does not retry when the first attempt produced text", async () => {
      const retry = vi.fn(() => generation(["should not run"]));
      await read(briefStream(generation(["Got it [1]."]), { recordUsage: vi.fn(), retry }));
      expect(retry).not.toHaveBeenCalled();
    });

    it("does not retry once the client has disconnected", async () => {
      const retry = vi.fn(() => generation(["wasted tokens"]));
      await read(
        briefStream(generation([]), {
          recordUsage: vi.fn(),
          retry,
          signal: { aborted: true },
        }),
      );
      expect(retry).not.toHaveBeenCalled();
    });

    // The retry drops the reasoning-suppression provider options, so a backend
    // that rejects that field outright still gets a plain request. Without
    // this, the new tuning could break generation harder than the bug it fixes.
    it("retries when the first attempt fails before writing anything", async () => {
      const retry = vi.fn(() => generation(["Recovered after rejection."]));
      const out = await read(
        briefStream(failing([], "unrecognized request argument: reasoning"), {
          recordUsage: vi.fn(),
          retry,
        }),
      );
      expect(retry).toHaveBeenCalledOnce();
      expect(body(out)).toBe("Recovered after rejection.");
      expect(out).not.toContain("generation error");
    });

    // That text is already on the reader's screen; a second attempt would
    // append a duplicate of it.
    it("does not retry a failure that arrives after some text", async () => {
      const retry = vi.fn(() => generation(["duplicate"]));
      const out = await read(
        briefStream(failing(["Half a section"], "died midway"), {
          recordUsage: vi.fn(),
          retry,
        }),
      );
      expect(retry).not.toHaveBeenCalled();
      expect(out).toContain("Half a section");
      expect(out).toContain("_(generation error: died midway)_");
    });

    it("reports the error when the retry fails too", async () => {
      const out = await read(
        briefStream(failing([], "first"), {
          recordUsage: vi.fn(),
          retry: () => failing([], "second"),
        }),
      );
      expect(out).toContain("_(generation error: second)_");
    });

    it("leaves the body empty when the retry also produces nothing", async () => {
      const out = await read(
        briefStream(generation([]), { recordUsage: vi.fn(), retry: () => generation([]) }),
      );
      // The client turns an empty body into its own retry-able error state.
      expect(body(out)).toBe("");
    });
  });

  describe("failures", () => {
    it("keeps the text already streamed and appends the error", async () => {
      const out = await read(
        briefStream(failing(["Partial answer"], "upstream exploded"), { recordUsage: vi.fn() }),
      );
      expect(out).toContain("Partial answer");
      expect(out).toContain("_(generation error: upstream exploded)_");
    });

    it("bills tokens burned before the failure, exactly once", async () => {
      const recordUsage = vi.fn();
      await read(briefStream(failing([], "boom"), { recordUsage }));
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(4);
    });

    it("stays silent when the failure is the client disconnecting", async () => {
      const out = await read(
        briefStream(failing(["half"], "aborted"), {
          recordUsage: vi.fn(),
          signal: { aborted: true },
        }),
      );
      expect(out).not.toContain("generation error");
    });

    it("never bills a generation that produced no usage at all", async () => {
      const recordUsage = vi.fn();
      const noUsage: TextGeneration = {
        textStream: (async function* () {
          yield "hi";
        })(),
        usage: Promise.resolve(undefined),
      };
      await read(briefStream(noUsage, { recordUsage }));
      expect(recordUsage).not.toHaveBeenCalled();
    });

    // A provider that never settles usage after a severed stream would
    // otherwise hold the response — and the serverless function — open.
    it("gives up on a usage promise that never settles", async () => {
      vi.useFakeTimers();
      try {
        const recordUsage = vi.fn();
        const hanging: TextGeneration = {
          textStream: (async function* () {
            yield "text";
          })(),
          usage: new Promise(() => {}), // never settles
        };
        const done = read(briefStream(hanging, { recordUsage }));
        await vi.advanceTimersByTimeAsync(USAGE_SETTLE_MS + 10);
        expect(await done).toContain("text");
        expect(recordUsage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    // The usage promise rejects on some providers when generation fails. That
    // must not become an unhandled rejection, nor take down the response.
    it("survives a usage promise that rejects", async () => {
      const recordUsage = vi.fn();
      const rejecting: TextGeneration = {
        textStream: (async function* () {
          yield "partial";
        })(),
        usage: Promise.reject(new Error("no usage available")),
      };
      const out = await read(briefStream(rejecting, { recordUsage }));
      expect(out).toContain("partial");
      expect(recordUsage).not.toHaveBeenCalled();
    });
  });

  describe("onDone", () => {
    it("receives the visible text with think blocks already removed", async () => {
      const onDone = vi.fn();
      await read(
        briefStream(generation(["<think>hidden</think>Cacheable text."]), {
          recordUsage: vi.fn(),
          onDone,
        }),
      );
      expect(onDone).toHaveBeenCalledWith("Cacheable text.", {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("is not called when generation failed", async () => {
      const onDone = vi.fn();
      await read(briefStream(failing([], "nope"), { recordUsage: vi.fn(), onDone }));
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The middleware resolves the user and the recorder lazily, so both are mocked
// at the module boundary rather than injected.
const recordAiUsage = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/auth", () => ({ getApiUser: async () => ({ user: currentUser }) }));
vi.mock("./budget", () => ({ recordAiUsage: (...a: unknown[]) => recordAiUsage(...a) }));

const { usageMeteringMiddleware } = await import("./usage-middleware");

/** Let the middleware's fire-and-forget reporting settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type StreamPart = { type: string; usage?: { promptTokens: number; completionTokens: number } };

function streamOf(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

async function drain(s: ReadableStream<StreamPart>): Promise<StreamPart[]> {
  const out: StreamPart[] = [];
  const reader = s.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const wrapGenerate = (o: any) => (usageMeteringMiddleware.wrapGenerate as any)(o);
const wrapStream = (o: any) => (usageMeteringMiddleware.wrapStream as any)(o);

beforeEach(() => {
  recordAiUsage.mockReset();
  currentUser = { id: "user-1" };
});
afterEach(() => vi.restoreAllMocks());

describe("usage metering — generate", () => {
  it("reports prompt + completion tokens", async () => {
    const doGenerate = vi.fn(async () => ({
      text: "hi",
      usage: { promptTokens: 100, completionTokens: 40 },
    }));
    await wrapGenerate({ doGenerate });
    await flush();
    expect(recordAiUsage).toHaveBeenCalledWith("user-1", 140);
  });

  it("passes the result through untouched", async () => {
    const result = { text: "answer", usage: { promptTokens: 1, completionTokens: 1 } };
    const out = await wrapGenerate({ doGenerate: async () => result });
    expect(out).toBe(result);
  });

  it("records nothing when the provider reports no usage", async () => {
    await wrapGenerate({ doGenerate: async () => ({ text: "hi", usage: undefined }) });
    await flush();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  // Providers can report NaN when a stream was cut short.
  it("ignores non-finite token counts", async () => {
    await wrapGenerate({
      doGenerate: async () => ({ usage: { promptTokens: NaN, completionTokens: NaN } }),
    });
    await flush();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("does not record outside a request context", async () => {
    currentUser = null; // cron / background job
    await wrapGenerate({
      doGenerate: async () => ({ usage: { promptTokens: 10, completionTokens: 10 } }),
    });
    await flush();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  // Losing a generation because a bookkeeping row failed would cost the user
  // real work — metering must never be able to fail a call.
  it("never fails the generation when recording throws", async () => {
    recordAiUsage.mockRejectedValueOnce(new Error("db down"));
    const out = await wrapGenerate({
      doGenerate: async () => ({ text: "safe", usage: { promptTokens: 5, completionTokens: 5 } }),
    });
    await flush();
    expect(out.text).toBe("safe");
  });

  it("propagates a genuine generation failure unchanged", async () => {
    await expect(
      wrapGenerate({
        doGenerate: async () => {
          throw new Error("upstream 500");
        },
      }),
    ).rejects.toThrow("upstream 500");
  });
});

describe("usage metering — stream", () => {
  it("reports the usage carried on the finish part", async () => {
    const parts: StreamPart[] = [
      { type: "text-delta" },
      { type: "finish", usage: { promptTokens: 200, completionTokens: 60 } },
    ];
    const { stream } = await wrapStream({ doStream: async () => ({ stream: streamOf(parts) }) });
    await drain(stream);
    await flush();
    expect(recordAiUsage).toHaveBeenCalledWith("user-1", 260);
  });

  it("passes every part through in order", async () => {
    const parts: StreamPart[] = [
      { type: "text-delta" },
      { type: "text-delta" },
      { type: "finish", usage: { promptTokens: 1, completionTokens: 1 } },
    ];
    const { stream } = await wrapStream({ doStream: async () => ({ stream: streamOf(parts) }) });
    expect((await drain(stream)).map((p) => p.type)).toEqual([
      "text-delta",
      "text-delta",
      "finish",
    ]);
  });

  it("preserves the other fields of the stream result", async () => {
    const out = await wrapStream({
      doStream: async () => ({ stream: streamOf([]), rawCall: { rawPrompt: "p" } }),
    });
    expect(out.rawCall).toEqual({ rawPrompt: "p" });
  });

  // A stream that ends without a finish part burned tokens we can't quantify;
  // it must still complete cleanly rather than hang or throw.
  it("records nothing for a stream that never reports usage", async () => {
    const { stream } = await wrapStream({
      doStream: async () => ({ stream: streamOf([{ type: "text-delta" }]) }),
    });
    await drain(stream);
    await flush();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});

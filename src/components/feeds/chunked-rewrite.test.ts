import { describe, expect, it, vi } from "vitest";
import { walkChunks } from "./chunked-rewrite";

/** Builds a fetch stub serving `chunks` from a chunk-addressed endpoint. */
function serve(
  chunks: string[],
  opts: { title?: string; failAt?: number; status?: number; throwAt?: number } = {},
): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const { chunk } = JSON.parse(String(init.body)) as { chunk: number };
    if (opts.throwAt === chunk) throw new Error("network down");
    if (opts.failAt === chunk) {
      return {
        ok: false,
        status: opts.status ?? 502,
        json: async () => ({ error: "boom" }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: chunks[chunk],
        title: chunk === 0 ? opts.title : undefined,
        chunkIndex: chunk,
        chunkCount: chunks.length,
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("walkChunks", () => {
  it("walks every chunk and concatenates in order", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["<p>a</p>", "<p>b</p>", "<p>c</p>"]) });
    expect(out).toEqual({ status: "ok", title: "", content: "<p>a</p><p>b</p><p>c</p>", partial: false });
  });

  it("stops after one request when the article is a single chunk", async () => {
    const fetchImpl = vi.fn(serve(["<p>only</p>"]));
    await walkChunks("/x", {}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("takes the title from the first chunk", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["a", "b"], { title: "Plain title" }) });
    expect(out).toMatchObject({ status: "ok", title: "Plain title" });
  });

  it("reports progress after each chunk", async () => {
    const seen: string[] = [];
    await walkChunks(
      "/x",
      {},
      { fetchImpl: serve(["a", "b", "c"]), onProgress: (p) => seen.push(p.content) },
    );
    expect(seen).toEqual(["a", "ab", "abc"]);
  });

  it("keeps what arrived when a later chunk fails", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["a", "b", "c"], { failAt: 2 }) });
    expect(out).toEqual({ status: "ok", title: "", content: "ab", partial: true });
  });

  it("keeps what arrived when the network drops mid-walk", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["a", "b", "c"], { throwAt: 1 }) });
    expect(out).toEqual({ status: "ok", title: "", content: "a", partial: true });
  });

  it("errors when the very first chunk fails, with the server's message", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["a"], { failAt: 0 }) });
    expect(out).toEqual({ status: "error", message: "boom" });
  });

  it("surfaces a 409 as a conflict rather than an error", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 409, json: async () => ({ sourceLang: "en" }) }) as Response) as unknown as typeof fetch;
    const out = await walkChunks("/x", {}, { fetchImpl });
    expect(out).toEqual({ status: "conflict", sourceLang: "en" });
  });

  it("bails out as stale once the reader has moved on", async () => {
    const out = await walkChunks("/x", {}, { fetchImpl: serve(["a", "b"]), isStale: () => true });
    expect(out).toEqual({ status: "stale" });
  });

  it("passes the caller's body fields through alongside the chunk index", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ content: "x", chunkCount: 1 }) } as Response;
    }) as unknown as typeof fetch;
    await walkChunks("/x", { target: "es" }, { fetchImpl });
    expect(bodies).toEqual([{ target: "es", chunk: 0 }]);
  });

  it("does not loop forever on a nonsense chunk count", async () => {
    const fetchImpl = vi.fn((async () =>
      ({ ok: true, status: 200, json: async () => ({ content: "x", chunkCount: 9999 }) }) as Response) as unknown as typeof fetch);
    const out = await walkChunks("/x", {}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(40);
    expect(out).toMatchObject({ status: "ok", partial: true });
  });
});

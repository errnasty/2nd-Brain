import { describe, expect, it, afterEach } from "vitest";
import {
  configuredProviders,
  isTranslatable,
  splitForLimit,
  translateHtml,
  translateSegments,
  translateText,
  visibleTextLength,
} from "./machine-translate";

/**
 * The real endpoints are keyless public services, so these tests stub fetch.
 * What's being verified is the part that can actually corrupt an article: which
 * strings get sent, that markup/URLs/code never do, and that what comes back is
 * put in the right place.
 */

/** Stub that upper-cases the query, so a translated slot is unmistakable. */
function stubFetch(
  onUrl?: (url: string) => void,
  behaviour: (text: string) => { ok: boolean; body: unknown } = (t) => ({
    ok: true,
    body: { translation: t.toUpperCase() },
  }),
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    onUrl?.(url);
    // Lingva puts the text in the path, MyMemory in the `q` param.
    const q = new URL(url).searchParams.get("q");
    const text = q ?? decodeURIComponent(url.split("/").pop() ?? "");
    const { ok, body } = behaviour(text);
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

const envKeys = ["TRANSLATE_PROVIDER", "LINGVA_BASE_URL", "MYMEMORY_EMAIL"] as const;
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isTranslatable", () => {
  it("accepts prose", () => {
    expect(isTranslatable("Hello world")).toBe(true);
    expect(isTranslatable("流体シミュレータ")).toBe(true);
  });

  it("rejects strings with no letters, which are identical in every language", () => {
    expect(isTranslatable("   ")).toBe(false);
    expect(isTranslatable("42")).toBe(false);
    expect(isTranslatable(" — ")).toBe(false);
    expect(isTranslatable("2026-07-25")).toBe(false);
  });
});

describe("splitForLimit", () => {
  it("leaves short text alone", () => {
    expect(splitForLimit("Short enough.", 100)).toEqual(["Short enough."]);
  });

  it("splits on sentence boundaries, keeping terminators", () => {
    const parts = splitForLimit("One two three. Four five six. Seven eight nine.", 30);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(30);
    expect(parts.join(" ")).toBe("One two three. Four five six. Seven eight nine.");
  });

  it("hard-splits a single sentence longer than the limit rather than looping", () => {
    const parts = splitForLimit("x".repeat(250), 100);
    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe("x".repeat(250));
  });

  it("handles CJK sentence terminators", () => {
    const parts = splitForLimit("これは文です。これも文です。これで三つ目です。", 12);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(12);
  });
});

describe("translateSegments", () => {
  it("translates every segment and keeps their order", async () => {
    const out = await translateSegments(["alpha", "beta", "gamma"], "es", {
      fetchImpl: stubFetch(),
      providers: ["lingva"],
    });
    expect(out).toEqual(["ALPHA", "BETA", "GAMMA"]);
  });

  it("falls back to the second provider when the first fails", async () => {
    const seen: string[] = [];
    const fetchImpl = stubFetch(
      (url) => seen.push(url),
      (t) =>
        seen.length === 1
          ? { ok: false, body: {} }
          : { ok: true, body: { responseStatus: 200, responseData: { translatedText: t.toUpperCase() } } },
    );
    const out = await translateSegments(["hello"], "es", {
      fetchImpl,
      providers: ["lingva", "mymemory"],
    });
    expect(out).toEqual(["HELLO"]);
    expect(seen[0]).toContain("lingva");
    expect(seen[1]).toContain("mymemory");
  });

  it("treats a MyMemory quota notice as a failure rather than a translation", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          responseStatus: 200,
          responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" },
        }),
      }) as Response) as unknown as typeof fetch;

    await expect(
      translateSegments(["hello"], "es", { fetchImpl, providers: ["mymemory"] }),
    ).rejects.toThrow(/quota/);
  });
});

describe("translateHtml", () => {
  it("translates prose but leaves tags and attributes untouched", async () => {
    const html = '<p>Hello there</p><h2 class="x">A heading</h2>';
    const out = await translateHtml(html, "es", { fetchImpl: stubFetch(), providers: ["lingva"] });
    expect(out).toBe('<p>HELLO THERE</p><h2 class="x">A HEADING</h2>');
  });

  it("never sends URLs to the engine and never changes them", async () => {
    const sent: string[] = [];
    const html = '<p>See <a href="https://example.com/a?b=c">the docs</a> now</p>';
    const out = await translateHtml(html, "es", {
      fetchImpl: stubFetch((u) => sent.push(u)),
      providers: ["lingva"],
    });
    expect(out).toContain('href="https://example.com/a?b=c"');
    expect(sent.join(" ")).not.toContain("example.com");
  });

  it("leaves code and pre content alone", async () => {
    const html = "<p>Run this</p><pre><code>const x = 1; // keep me</code></pre>";
    const out = await translateHtml(html, "es", { fetchImpl: stubFetch(), providers: ["lingva"] });
    expect(out).toContain("<code>const x = 1; // keep me</code>");
    expect(out).toContain("RUN THIS");
  });

  it("preserves whitespace around inline tags so words don't fuse", async () => {
    const html = "<p>the <em>fluid</em> equations</p>";
    const out = await translateHtml(html, "es", { fetchImpl: stubFetch(), providers: ["lingva"] });
    expect(out).toBe("<p>THE <em>FLUID</em> EQUATIONS</p>");
  });

  it("translates alt and title text", async () => {
    const html = '<img src="/a.png" alt="a duck">';
    const out = await translateHtml(html, "es", { fetchImpl: stubFetch(), providers: ["lingva"] });
    expect(out).toContain('alt="A DUCK"');
    expect(out).toContain('src="/a.png"');
  });

  it("skips text with no letters instead of spending quota on it", async () => {
    const sent: string[] = [];
    const html = "<p>42</p><p>Real words</p>";
    await translateHtml(html, "es", {
      fetchImpl: stubFetch((u) => sent.push(u)),
      providers: ["lingva"],
    });
    expect(sent).toHaveLength(1);
    expect(decodeURIComponent(sent[0])).toContain("Real words");
  });

  it("returns empty for empty input without calling out", async () => {
    const sent: string[] = [];
    expect(await translateHtml("   ", "es", { fetchImpl: stubFetch((u) => sent.push(u)) })).toBe("");
    expect(sent).toHaveLength(0);
  });

  it("round-trips entities rather than double-encoding them", async () => {
    const html = "<p>Fish &amp; chips</p>";
    const out = await translateHtml(html, "es", { fetchImpl: stubFetch(), providers: ["lingva"] });
    expect(out).toContain("&amp;");
    expect(out).not.toContain("&amp;amp;");
  });
});

describe("translateText", () => {
  it("translates a title", async () => {
    const out = await translateText("A headline", "es", {
      fetchImpl: stubFetch(),
      providers: ["lingva"],
    });
    expect(out).toBe("A HEADLINE");
  });

  it("returns letterless input unchanged without a call", async () => {
    const sent: string[] = [];
    expect(await translateText("2026", "es", { fetchImpl: stubFetch((u) => sent.push(u)) })).toBe("2026");
    expect(sent).toHaveLength(0);
  });
});

describe("configuredProviders", () => {
  it("defaults to lingva first", () => {
    delete process.env.TRANSLATE_PROVIDER;
    expect(configuredProviders()[0]).toBe("lingva");
  });

  it("honours the env override", () => {
    process.env.TRANSLATE_PROVIDER = "mymemory";
    expect(configuredProviders()).toEqual(["mymemory", "lingva"]);
  });
});

describe("visibleTextLength", () => {
  it("counts prose, not markup", () => {
    expect(visibleTextLength('<p class="verylongclassname">abc</p>')).toBe(3);
  });
});

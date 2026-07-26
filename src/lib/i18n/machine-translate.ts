/**
 * Machine translation for article bodies — deliberately NOT an LLM.
 *
 * Translation is a solved, deterministic problem: a real MT engine returns the
 * same answer every time, in a few hundred milliseconds, for free. Asking a
 * chat model to translate an article costs tokens, takes tens of seconds, and
 * can decide to summarise, editorialise or mangle the markup instead. So this
 * module talks to a plain MT endpoint and keeps the model out of it entirely.
 *
 * Markup is preserved structurally rather than by asking anything nicely: the
 * HTML is parsed, only its text nodes (plus alt/title text) are sent for
 * translation, and the results are written back into the same tree. Tags,
 * attributes, hrefs and code blocks are never sent anywhere and therefore
 * cannot come back changed.
 */

import { parseDocument } from "htmlparser2";
import { textContent } from "domutils";
import render from "dom-serializer";
import type { AnyNode, Element, Text } from "domhandler";
import { isTag, isText } from "domhandler";

/** Providers cap the length of a single query; longer text is split first. */
const PROVIDER_LIMITS: Record<MtProviderName, number> = {
  lingva: 1800, // GET path segment — keep the whole URL well under 2 kB
  mymemory: 480, // documented `q` limit is 500 bytes
};

/** Elements whose text is not prose and must survive byte-for-byte. */
const OPAQUE_TAGS = new Set(["code", "pre", "kbd", "samp", "var", "script", "style"]);

/** Attributes that carry human-readable text worth translating. */
const TEXT_ATTRS = ["alt", "title"] as const;

export type MtProviderName = "lingva" | "mymemory";

export type MtOptions = {
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Source language, or null to let the engine auto-detect. */
  source?: string | null;
  /** Overrides the env-configured provider order. */
  providers?: MtProviderName[];
  /** Abort the whole batch once this much wall-clock has gone. */
  budgetMs?: number;
};

export class MtError extends Error {}

function lingvaBase(): string {
  return (process.env.LINGVA_BASE_URL || "https://lingva.ml").replace(/\/+$/, "");
}

/**
 * Provider order. Both are keyless public endpoints, so the fallback exists
 * because free instances go down, not because one needs credentials.
 */
export function configuredProviders(): MtProviderName[] {
  const first = process.env.TRANSLATE_PROVIDER;
  if (first === "mymemory") return ["mymemory", "lingva"];
  return ["lingva", "mymemory"];
}

async function callLingva(
  text: string,
  target: string,
  source: string | null,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const from = source || "auto";
  const url = `${lingvaBase()}/api/v1/${from}/${target}/${encodeURIComponent(text)}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new MtError(`lingva ${res.status}`);
  const data = (await res.json()) as { translation?: unknown };
  if (typeof data.translation !== "string") throw new MtError("lingva: no translation");
  return data.translation;
}

async function callMyMemory(
  text: string,
  target: string,
  source: string | null,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: `${source || "autodetect"}|${target}` });
  // An email raises the anonymous daily character cap from ~5k to ~50k. Optional
  // on purpose: the feature has to work with nothing configured at all.
  if (process.env.MYMEMORY_EMAIL) params.set("de", process.env.MYMEMORY_EMAIL);
  const res = await fetchImpl(`https://api.mymemory.translated.net/get?${params}`, { signal });
  if (!res.ok) throw new MtError(`mymemory ${res.status}`);
  const data = (await res.json()) as {
    responseStatus?: number | string;
    responseData?: { translatedText?: unknown };
  };
  const status = Number(data.responseStatus);
  if (status && status !== 200) throw new MtError(`mymemory responseStatus ${status}`);
  const out = data.responseData?.translatedText;
  if (typeof out !== "string") throw new MtError("mymemory: no translation");
  // The free tier answers over-quota with a plain-text notice in the body
  // rather than an error status, which would otherwise be pasted into the
  // article as if it were the translation.
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new MtError("mymemory quota");
  return out;
}

const CALLERS: Record<
  MtProviderName,
  (t: string, target: string, source: string | null, f: typeof fetch, s: AbortSignal) => Promise<string>
> = { lingva: callLingva, mymemory: callMyMemory };

/**
 * Split a long string into provider-sized pieces at sentence boundaries, so a
 * long paragraph is never cut mid-clause (which is where MT quality collapses).
 */
export function splitForLimit(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let cur = "";
  // Keep the terminator with the sentence it ends.
  for (const sentence of text.split(/(?<=[.!?。！？…])\s+/)) {
    if (sentence.length > limit) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < sentence.length; i += limit) out.push(sentence.slice(i, i + limit));
      continue;
    }
    if (cur.length + sentence.length + 1 > limit) {
      out.push(cur);
      cur = sentence;
    } else {
      cur = cur ? `${cur} ${sentence}` : sentence;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Text with no letters in it (numbers, punctuation, separators) is the same in
 *  every language — translating it wastes quota and often corrupts it. */
export function isTranslatable(text: string): boolean {
  return /\p{L}/u.test(text);
}

/**
 * Translate a list of strings. Runs with bounded concurrency: these endpoints
 * are free and shared, and firing a hundred parallel GETs at one is both rude
 * and the fastest route to a rate-limit block.
 */
export async function translateSegments(
  texts: string[],
  target: string,
  opts: MtOptions = {},
): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const source = opts.source ?? null;
  const providers = opts.providers ?? configuredProviders();
  const budgetMs = opts.budgetMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

  const out = new Array<string>(texts.length);
  let next = 0;

  async function one(text: string): Promise<string> {
    let lastErr: unknown;
    for (const name of providers) {
      try {
        const pieces = splitForLimit(text, PROVIDER_LIMITS[name]);
        const done: string[] = [];
        for (const piece of pieces) {
          done.push(await CALLERS[name](piece, target, source, fetchImpl, controller.signal));
        }
        return done.join(" ");
      } catch (err) {
        lastErr = err;
        // An aborted budget is not a provider fault — stop, don't retry the
        // next one with a signal that is already dead.
        if (controller.signal.aborted) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new MtError("all providers failed");
  }

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= texts.length) return;
      out[i] = await one(texts[i]);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/** A translatable slot in the parsed tree: either a text node or an attribute. */
type Slot =
  | { kind: "text"; node: Text }
  | { kind: "attr"; node: Element; name: string };

function collectSlots(nodes: AnyNode[], acc: Slot[], opaque = false): void {
  for (const node of nodes) {
    if (isText(node)) {
      if (!opaque && isTranslatable(node.data)) acc.push({ kind: "text", node });
      continue;
    }
    if (!isTag(node)) continue;
    const inOpaque = opaque || OPAQUE_TAGS.has(node.name.toLowerCase());
    if (!inOpaque) {
      for (const name of TEXT_ATTRS) {
        const v = node.attribs[name];
        if (v && isTranslatable(v)) acc.push({ kind: "attr", node, name });
      }
    }
    collectSlots(node.children as AnyNode[], acc, inOpaque);
  }
}

/**
 * Translate an HTML fragment, returning HTML with the same structure.
 *
 * Only prose is sent to the engine — never tags, URLs or code — so the markup
 * cannot come back altered. Leading/trailing whitespace on each text node is
 * preserved so words don't fuse together at inline-tag boundaries.
 */
export async function translateHtml(
  html: string,
  target: string,
  opts: MtOptions = {},
): Promise<string> {
  if (!html.trim()) return "";
  const doc = parseDocument(html);
  const slots: Slot[] = [];
  collectSlots(doc.children as AnyNode[], slots);
  if (slots.length === 0) return html;

  const originals = slots.map((s) =>
    s.kind === "text" ? s.node.data : s.node.attribs[s.name],
  );
  // Whitespace at the edges is layout, not language: the engine strips it, and
  // losing it welds "the <em>fluid</em> equations" into "thefluidequations".
  const trimmed = originals.map((t) => t.trim());
  const translated = await translateSegments(trimmed, target, opts);

  slots.forEach((slot, i) => {
    const original = originals[i];
    const lead = original.match(/^\s*/)?.[0] ?? "";
    const tail = original.match(/\s*$/)?.[0] ?? "";
    const value = `${lead}${translated[i]}${tail}`;
    if (slot.kind === "text") slot.node.data = value;
    else slot.node.attribs[slot.name] = value;
  });

  return render(doc, { decodeEntities: true });
}

/** Plain-text translation for titles, where markup isn't in play. */
export async function translateText(
  text: string,
  target: string,
  opts: MtOptions = {},
): Promise<string> {
  if (!isTranslatable(text)) return text;
  const [out] = await translateSegments([text.trim()], target, opts);
  return out;
}

/** Visible text length of an HTML fragment — used to budget free-tier quota. */
export function visibleTextLength(html: string): number {
  return textContent(parseDocument(html)).trim().length;
}

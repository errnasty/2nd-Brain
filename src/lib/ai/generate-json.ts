import { generateObject, generateText, type LanguageModelV1, type LanguageModelUsage } from "ai";
import type { z } from "zod";

/**
 * Every valid top-level JSON value (object or array) in `text`, in the order
 * their opening delimiters appear, found with proper brace/bracket matching.
 *
 * This is far more robust than slicing first-`{`→last-`}`: a reasoning model's
 * reply can lead with long thinking prose that itself contains braces, and a
 * naive slice then spans garbage and fails to parse. Here each `{`/`[` is
 * matched to its balanced close (respecting nested objects, arrays, and quoted
 * strings) and the slice is parsed; invalid candidates are skipped.
 */
export function extractJsonValues(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === ch) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j < text.length) {
      try {
        out.push(JSON.parse(text.slice(i, j + 1)));
      } catch {
        // unbalanced/invalid — skip this candidate
      }
      // Skip past this value so we don't re-find nested ones first.
      i = j;
    }
  }
  return out;
}

/** The first JSON value in `text` that satisfies `schema`, else null. */
export function extractJsonBySchema<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  for (const value of extractJsonValues(text)) {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
  }
  return null;
}

export type GenerateJsonInput<S extends z.ZodType> = {
  model: LanguageModelV1;
  schema: S;
  system: string;
  prompt: string;
  /** Cap for the schema-enforced (`generateObject`) pass. */
  maxTokens?: number;
};

export type GenerateJsonResult<S extends z.ZodType> = {
  object: z.infer<S> | null;
  /** Token usage from whichever pass succeeded; null when both failed. */
  usage: LanguageModelUsage | null;
};

/**
 * Generate a schema-valid JSON object, with a text-mode fallback for models
 * whose structured-output mode is unreliable.
 *
 * Many OpenRouter value/reasoning models (DeepSeek V4 Flash, `openrouter/auto`,
 * free tier) don't honor `generateObject`'s JSON-schema mode and instead wrap
 * the answer in prose or ``` fences, making the SDK throw "No object generated:
 * could not parse the response". Every feature that called `generateObject`
 * directly then degraded to "AI couldn't generate anything". This wrapper
 * retries once as plain text and extracts the model's JSON tolerantly, so a
 * picky model still yields a result. Never throws — returns `object: null`
 * when both passes fail, and callers keep their existing fail-soft behavior.
 */
export async function generateJsonResult<S extends z.ZodType>(
  input: GenerateJsonInput<S>,
): Promise<GenerateJsonResult<S>> {
  const { model, schema, system, prompt, maxTokens } = input;
  try {
    const { object, usage } = await generateObject({
      model,
      schema: schema as z.ZodType,
      system,
      prompt,
      maxTokens,
    });
    return { object: object as z.infer<S>, usage };
  } catch (err) {
    console.warn(
      "generateJson object pass failed, retrying as text:",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    // Text mode needs room to "think" before the JSON; a tight cap truncates
    // the answer mid-object so nothing parses.
    const { text: reply, usage } = await generateText({
      model,
      system: `${system}\n\nOutput ONLY a single JSON object with exactly the structure requested. No prose, no bullets, no code fences.`,
      prompt,
      maxTokens: Math.min(60_000, Math.max(maxTokens ?? 2000, 2500)),
    });
    const parsed = extractJsonBySchema<S>(reply, schema);
    if (parsed === null) {
      console.warn("generateJson text fallback had no parseable JSON. reply:", reply.slice(0, 300));
    }
    return { object: parsed, usage };
  } catch (err2) {
    console.warn(
      "generateJson text fallback failed:",
      err2 instanceof Error ? err2.message : err2,
    );
    return { object: null, usage: null };
  }
}

/** Convenience wrapper returning just the parsed object (null on failure). */
export async function generateJson<S extends z.ZodType>(
  input: GenerateJsonInput<S>,
): Promise<z.infer<S> | null> {
  return (await generateJsonResult(input)).object;
}

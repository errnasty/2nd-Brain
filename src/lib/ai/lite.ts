import type { LanguageModelV1 } from "ai";
import { openrouterClient, openrouterKey } from "./provider";
import { userFastModel } from "./user-model";

/**
 * The "lite" tier: high-volume housekeeping calls (tagging, folder routing,
 * auto-organize, skill classification) where output quality barely moves the
 * product but volume drives cost. Runs on free OpenRouter models when an
 * OpenRouter key is configured.
 *
 * Free models are rate-limited and periodically unavailable, so this is a
 * fallback CHAIN, not a single model: each candidate is tried in order and
 * the regular fast model is always the last resort — a flaky free model can
 * cost a retry, never a feature. Override the list with
 * OPENROUTER_LITE_MODELS (comma-separated slugs); set it empty to disable
 * the free tier entirely.
 */
const FREE_LITE_DEFAULTS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-m.1:free",
];

function freeLiteModels(): LanguageModelV1[] {
  if (!openrouterKey()) return [];
  const raw = process.env.OPENROUTER_LITE_MODELS;
  const slugs =
    raw === undefined ? FREE_LITE_DEFAULTS : raw.split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.map((s) => openrouterClient()(s));
}

/** Run `fn` against the lite chain, falling through on any error. The paid
 *  fast model is the last resort; only its failure propagates to the caller
 *  (whose existing fail-soft handling applies, same as before this tier). */
export async function withLiteModel<T>(fn: (model: LanguageModelV1) => Promise<T>): Promise<T> {
  for (const model of freeLiteModels()) {
    try {
      return await fn(model);
    } catch (err) {
      console.warn(
        "lite model failed, falling through:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return fn(await userFastModel());
}

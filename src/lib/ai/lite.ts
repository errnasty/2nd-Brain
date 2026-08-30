import type { LanguageModelV1 } from "ai";
import { anthropicRescueModel, openrouterClient, openrouterKey } from "./provider";
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
// Kept deliberately short. Free routes are retired without notice — this list
// previously carried "poolside/laguna-m.1:free" long after OpenRouter stopped
// serving it, and every call spent a round trip discovering that. Add more with
// OPENROUTER_LITE_MODELS rather than growing this.
const FREE_LITE_DEFAULTS = ["nvidia/nemotron-3-ultra-550b-a55b:free"];

function freeLiteModels(): LanguageModelV1[] {
  if (!openrouterKey()) return [];
  const raw = process.env.OPENROUTER_LITE_MODELS;
  const slugs =
    raw === undefined ? FREE_LITE_DEFAULTS : raw.split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.map((s) => openrouterClient()(s));
}

/**
 * Run `fn` against the lite chain, falling through on any error.
 *
 * Order: the free models, then the configured fast model, then — if the fast
 * model also fails and it was not Anthropic's — Anthropic. That last hop is
 * what stops a stale model slug from silently disabling a feature: without it
 * the whole chain lives on one provider, so one retired route means no tags,
 * no folder routing and no skill classification, with no error anywhere the
 * user can see. Only the final failure propagates, and every caller already
 * treats that as "no result" rather than an error.
 */
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

  try {
    return await fn(await userFastModel());
  } catch (err) {
    const rescue = anthropicRescueModel();
    if (!rescue) throw err;
    console.warn(
      "fast model failed, rescuing with Anthropic:",
      err instanceof Error ? err.message : err,
    );
    return fn(rescue);
  }
}

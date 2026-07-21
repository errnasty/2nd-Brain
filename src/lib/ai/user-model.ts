import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, type ChatModel } from "./models";
import { fastModel, smartModel, openrouterClient, openrouterKey } from "./provider";

/**
 * Resolves the signed-in user's chosen AI model (Settings → Default AI model)
 * so it applies to EVERY generation call in the app, not just the Ask
 * surfaces. Fail-soft by design: outside a request (cron), with no valid
 * choice, or when the chosen provider's key isn't configured, callers get the
 * env-driven fast/smart defaults — a settings read must never break an AI
 * feature. Both auth and settings reads are React-cache()d, so the extra
 * lookups cost one query per request at most.
 */
export async function userModelChoice(): Promise<ChatModel | null> {
  try {
    // Lazy imports keep auth/db out of this module's load graph: the AI libs
    // that call this are unit-tested without a database, and the db module
    // throws at load when DATABASE_URL is unset — the catch below turns that
    // into "no choice, use defaults".
    const [{ getApiUser }, { getUserSettings }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/settings/store"),
    ]);
    const { user } = await getApiUser();
    if (!user) return null;
    const s = await getUserSettings(user.id);
    if (!s.aiModel) return null;
    const m = CHAT_MODELS.find((x) => x.id === s.aiModel);
    if (!m) return null;
    if (m.provider === "openrouter" && !openrouterKey()) return null;
    if (m.provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) return null;
    if (m.provider === "openai" && !process.env.OPENAI_API_KEY) return null;
    return m;
  } catch {
    return null; // no request context (cron/jobs) or a transient read failure
  }
}

function instantiate(m: ChatModel): LanguageModelV1 {
  if (m.provider === "openrouter") return openrouterClient()(m.id);
  if (m.provider === "openai") return openai(m.id);
  return anthropic(m.id);
}

/** The user's chosen model, else the env smart default. */
export async function userSmartModel(): Promise<LanguageModelV1> {
  const m = await userModelChoice();
  return m ? instantiate(m) : smartModel();
}

/** The user's chosen model, else the env fast default. */
export async function userFastModel(): Promise<LanguageModelV1> {
  const m = await userModelChoice();
  return m ? instantiate(m) : fastModel();
}

/**
 * Model id for the Anthropic-native web_search paths (webAnswerOnce), which
 * can only run Anthropic models: the user's choice when it IS an Anthropic
 * model, else the default. Non-Anthropic choices simply keep the default for
 * these calls (their generation happens on the fallback paths instead).
 */
export async function anthropicWebModel(): Promise<string> {
  const m = await userModelChoice();
  return m?.provider === "anthropic" ? m.id : DEFAULT_CHAT_MODEL;
}

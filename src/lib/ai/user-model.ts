import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, type ChatModel, type ChatProvider } from "./models";
import { withUsageMetering } from "./usage-middleware";
import {
  activeProvider,
  fastModel,
  smartModel,
  smartModelId,
  openrouterClient,
  openrouterKey,
  openrouterReasoningClient,
} from "./provider";

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

/**
 * The user's chosen model, else the env smart default.
 *
 * Metered. This resolver and `userFastModel` are what every AI feature outside
 * the Ask/brief routes generates through, and none of those callers recorded
 * token usage — so the daily budget only ever saw a fraction of real
 * consumption. Metering here covers all of them at once; see
 * `usage-middleware.ts` for why it belongs at this layer and why it only
 * reports rather than blocks.
 */
export async function userSmartModel(): Promise<LanguageModelV1> {
  const m = await userModelChoice();
  return withUsageMetering(m ? instantiate(m) : smartModel());
}

/** A model instance plus the facts a caller needs to size a request for it. */
export type ResolvedModel = {
  model: LanguageModelV1;
  /** Concrete model id — an env default here may be any OpenRouter slug, so
   *  this is NOT necessarily one of `CHAT_MODELS`. */
  id: string;
  provider: ChatProvider;
};

/**
 * The user's chosen model — or the env default — resolved together with its id
 * and provider, for callers that put a hard ceiling on output tokens.
 *
 * Such a caller can't just take a `LanguageModelV1`: whether the ceiling has to
 * cover a hidden reasoning pass, and how to ask for that pass to be skipped,
 * both depend on which model actually got picked (see the reasoning helpers in
 * `models.ts`). OpenRouter is instantiated through the reasoning-capable client
 * because it is the only one that can carry the "don't think" request field.
 */
export async function resolveUserSmartModel(): Promise<ResolvedModel> {
  const choice = await userModelChoice();
  if (choice) {
    return {
      model:
        choice.provider === "openrouter"
          ? openrouterReasoningClient()(choice.id)
          : instantiate(choice),
      id: choice.id,
      provider: choice.provider,
    };
  }
  // No stored choice (or its key isn't configured) — the env default, resolved
  // the same way so it gets the same treatment.
  const provider = activeProvider();
  const id = smartModelId();
  return {
    model: provider === "openrouter" ? openrouterReasoningClient()(id) : anthropic(id),
    id,
    provider,
  };
}

/** The user's chosen model, else the env fast default. Metered — see
 *  `userSmartModel` above. */
export async function userFastModel(): Promise<LanguageModelV1> {
  const m = await userModelChoice();
  return withUsageMetering(m ? instantiate(m) : fastModel());
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

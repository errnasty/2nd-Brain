/**
 * Language-model middleware that reports every generation's token usage.
 *
 * ## Why this exists
 *
 * `AI_DAILY_TOKEN_BUDGET` is documented as a per-user daily cost cap, and
 * `checkAiBudget` enforces it — but enforcement only ever sees what
 * `recordAiUsage` was told about, and that was called by hand in six API
 * routes. Every AI feature reached through a server action instead — tagging,
 * flashcards, quizzes, study plans, distill, simplify, organize, edit-assist,
 * ThinkTank decks, weekly synthesis, skill classification — recorded nothing.
 * The cap was real for Ask and the brief, and absent for most of the app: the
 * usage meter in Settings under-reported, and a budget that should have
 * tripped never did.
 *
 * Metering at the model layer fixes that for every caller at once, including
 * ones added later, without threading a userId through seventeen modules that
 * have no reason to know about billing.
 *
 * ## Scope: metering, not enforcement
 *
 * This only REPORTS usage. It never blocks a call, and it never throws — a
 * generation must not fail because bookkeeping did. Refusing work over budget
 * stays with the existing `checkAiBudget` gates, which are per-surface
 * decisions (a blocked Ask should say so; a blocked background tagging pass
 * probably should not). What changes is that those gates now see the whole
 * picture instead of a fraction of it.
 *
 * Applied in `user-model.ts` to the shared `userSmartModel`/`userFastModel`
 * resolvers. Surfaces that resolve their own model and already record usage
 * explicitly — Ask, ask-document, rabbithole, agent, and the Daily Brief —
 * deliberately do NOT go through here, so nothing is counted twice.
 */

import { wrapLanguageModel, type LanguageModelV1, type LanguageModelV1Middleware } from "ai";

/** Tokens from one generation, however the provider reported them. */
function totalOf(usage: { promptTokens?: number; completionTokens?: number } | undefined): number {
  if (!usage) return 0;
  const prompt = Number.isFinite(usage.promptTokens) ? (usage.promptTokens ?? 0) : 0;
  const completion = Number.isFinite(usage.completionTokens) ? (usage.completionTokens ?? 0) : 0;
  return prompt + completion;
}

/**
 * Record `tokens` against the signed-in user, if there is one.
 *
 * Everything here is best-effort by design. Background jobs and crons run with
 * no request context, and a metering failure must never surface as a failed
 * generation — the user would lose real work over a bookkeeping row.
 */
async function report(tokens: number): Promise<void> {
  if (tokens <= 0) return;
  try {
    // Lazy imports keep auth/db out of this module's load graph, matching
    // `user-model.ts` — the AI libs that pull this in are unit-tested with no
    // database, and the db module throws at load when DATABASE_URL is unset.
    const [{ getApiUser }, { recordAiUsage }] = await Promise.all([
      import("@/lib/auth"),
      import("./budget"),
    ]);
    const { user } = await getApiUser();
    if (!user) return;
    await recordAiUsage(user.id, tokens);
  } catch {
    // No request context, or a transient read failure. Fail open.
  }
}

/**
 * Middleware that reports token usage for both generate and stream calls.
 *
 * Streaming usage isn't known until the provider's terminating `finish` part
 * arrives, so the stream is passed through a transform that watches for it
 * rather than being buffered — the caller still gets parts as they land.
 */
export const usageMeteringMiddleware: LanguageModelV1Middleware = {
  middlewareVersion: "v1",

  async wrapGenerate({ doGenerate }) {
    const result = await doGenerate();
    void report(totalOf(result.usage));
    return result;
  },

  async wrapStream({ doStream }) {
    const { stream, ...rest } = await doStream();
    let tokens = 0;
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            // `finish` carries the usage totals and is the last part emitted.
            if (part.type === "finish") tokens = totalOf(part.usage);
            controller.enqueue(part);
          },
          flush() {
            // Reported from flush, not from the `finish` branch, so a stream
            // that is torn down early still books whatever it burned.
            void report(tokens);
          },
        }),
      ),
    };
  },
};

/** `model` with usage metering attached. */
export function withUsageMetering(model: LanguageModelV1): LanguageModelV1 {
  return wrapLanguageModel({ model, middleware: usageMeteringMiddleware });
}

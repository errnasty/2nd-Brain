/**
 * Reading brief verdicts back out for the planner.
 *
 * Separate from `src/app/(app)/today/actions.ts` because that file is a
 * `"use server"` module, where every export becomes an endpoint the browser can
 * call. A loader that takes a `userId` would be exactly the wrong thing to
 * expose there — anyone could pass somebody else's. The write path stays an
 * action (it authenticates and derives the user itself); this read is only ever
 * called by server code that has already established whose brief it is.
 *
 * Separate from `brief-feedback.ts` because that file is pure arithmetic and
 * unit-tested as such; this is the query.
 */

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefFeedback } from "@/lib/db/schema";
import { FEEDBACK_WINDOW_DAYS, deskWeights, type FeedbackRow } from "./brief-feedback";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * This user's desk weights, decayed and clamped.
 *
 * Fail-soft: a pending migration or a slow read costs one brief its
 * personalization, never the brief itself.
 */
export async function loadDeskWeights(
  userId: string,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select({
        topicId: briefFeedback.topicId,
        verdict: briefFeedback.verdict,
        createdAt: briefFeedback.createdAt,
      })
      .from(briefFeedback)
      .where(
        and(
          eq(briefFeedback.userId, userId),
          gte(briefFeedback.createdAt, new Date(now.getTime() - FEEDBACK_WINDOW_DAYS * DAY_MS)),
        ),
      );
    return deskWeights(rows as FeedbackRow[], now);
  } catch {
    return {};
  }
}

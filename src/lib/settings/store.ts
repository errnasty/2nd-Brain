import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userSettings, type UserSettingsData } from "@/lib/db/schema";

/**
 * Read a user's merged settings blob. Returns `{}` when no row exists yet, so
 * callers never have to special-case a first-time user.
 *
 * Wrapped in React cache(): the app layout reads settings on every navigation
 * and several pages read them again in the same request — dedupe to one query
 * per request instead of one per segment.
 */
export const getUserSettings = cache(async (userId: string): Promise<UserSettingsData> => {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row?.settings ?? {};
});

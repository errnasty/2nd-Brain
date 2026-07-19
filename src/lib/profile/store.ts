import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

/**
 * The user's chosen display name, or null when unset. React cache(): the app
 * layout and pages (Today, Settings) both read it in the same request — one
 * query per request, not one per segment.
 */
export const getDisplayName = cache(async (userId: string): Promise<string | null> => {
  const [row] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row?.displayName ?? null;
});

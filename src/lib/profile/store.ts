import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

/** The user's chosen display name, or null when unset. */
export async function getDisplayName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row?.displayName ?? null;
}

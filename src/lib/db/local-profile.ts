import { db } from "./index";
import { profiles } from "./schema";

// On the cloud, a Supabase trigger creates a `profiles` row per auth user. The
// local PGlite DB has no such trigger, so the desktop app creates the row
// itself the first time it sees the signed-in user (every FK targets profiles).
const ensured = new Set<string>();

export async function ensureLocalProfile(userId: string, email?: string | null): Promise<void> {
  if (ensured.has(userId)) return;
  try {
    await db.insert(profiles).values({ id: userId, email: email ?? null }).onConflictDoNothing();
    ensured.add(userId);
  } catch (err) {
    console.warn("ensureLocalProfile failed:", err instanceof Error ? err.message : err);
  }
}

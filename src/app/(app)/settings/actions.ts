"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, syncTombstones } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently deletes the calling user's account and ALL their data.
 *
 * Order matters:
 * 1. sync_tombstones has no FK to profiles — delete those rows explicitly.
 * 2. Deleting the profiles row cascades through every other user table
 *    (all 19 of them FK onto profiles.id with onDelete: cascade).
 * 3. Finally remove the Supabase Auth user via the service-role admin API,
 *    which invalidates every session/refresh token.
 *
 * Steps 1-2 run first so that even if the admin API call fails the user's
 * data is already gone; a retry (or manual dashboard delete) only has the
 * bare auth record left to clean up.
 *
 * Desktop runtime is blocked: PGlite has no Supabase admin API, and account
 * lifecycle belongs to the cloud deployment.
 */
export async function deleteAccountAction(confirmation: string): Promise<DeleteAccountResult> {
  if (process.env.APP_RUNTIME === "desktop") {
    return { ok: false, error: "Account deletion is available in the web app only." };
  }
  // Server-side re-check of the type-DELETE confirmation. UI enforces it too;
  // this makes the action safe even if called directly.
  if (confirmation !== "DELETE") {
    return { ok: false, error: "Confirmation phrase mismatch." };
  }

  const { user } = await requireUser();

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — deletion unavailable.",
    };
  }

  try {
    await db.delete(syncTombstones).where(eq(syncTombstones.userId, user.id));
    await db.delete(profiles).where(eq(profiles.id, user.id));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete account data.",
    };
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // Data is gone; only the bare auth record remains. Surface it so the
    // owner can finish the cleanup in the Supabase dashboard if needed.
    return { ok: false, error: `Data deleted, but removing the login failed: ${error.message}` };
  }

  return { ok: true };
}

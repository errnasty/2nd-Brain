"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * Set the user's display name (shown in the Today greeting and the sidebar
 * masthead). First UI write path to profiles.displayName. An empty string
 * clears the name (falls back to the email-derived greeting).
 */
export async function updateDisplayNameAction(displayName: string) {
  const { user } = await requireUser();
  const trimmed = displayName.trim().slice(0, 60);
  await db
    .update(profiles)
    .set({ displayName: trimmed || null, updatedAt: new Date() })
    .where(eq(profiles.id, user.id));
  revalidatePath("/today");
  revalidatePath("/settings");
  return { ok: true as const, displayName: trimmed || null };
}

"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { userSettings, type UserSettingsData } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * Shallow-merge a patch into the user's settings JSONB (upsert). Top-level keys
 * in `patch` replace existing ones, so nested objects (e.g. `wipLimits`) must be
 * sent whole. Returns `{ ok }`.
 */
export async function updateUserSettingsAction(patch: Partial<UserSettingsData>) {
  const { user } = await requireUser();
  await db
    .insert(userSettings)
    .values({ userId: user.id, settings: patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        // jsonb `||` concat = shallow merge of the two objects.
        settings: sql`${userSettings.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      },
    });
  revalidatePath("/directory");
  return { ok: true as const };
}

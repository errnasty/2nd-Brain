"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { itemTags, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { tagSlug } from "@/lib/ai/tagging";

const RenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
});

export async function renameTagAction(input: { id: string; name: string }) {
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Name required" };

  const { user } = await requireUser();
  const name = parsed.data.name;
  const slug = tagSlug(name);
  if (!slug) return { ok: false as const, error: "Invalid name" };

  try {
    await db
      .update(tags)
      .set({ name, slug })
      .where(and(eq(tags.id, parsed.data.id), eq(tags.userId, user.id)));
    revalidatePath("/tags");
    revalidatePath("/directory");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "A tag with that name already exists" };
  }
}

/**
 * Delete a tag and remove all of its item_tags links. Items themselves are
 * untouched — they just lose their connection to this tag.
 */
export async function deleteTagAction(tagId: string) {
  const { user } = await requireUser();
  // Remove polymorphic links first (no FK cascade because item_tags.itemId is
  // polymorphic and references multiple tables).
  await db
    .delete(itemTags)
    .where(and(eq(itemTags.tagId, tagId), eq(itemTags.userId, user.id)));
  await db
    .delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, user.id)));
  revalidatePath("/tags");
  revalidatePath("/directory");
}

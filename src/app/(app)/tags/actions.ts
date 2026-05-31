"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { itemTags, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { tagSlug } from "@/lib/ai/tagging";
import { bustMapCache } from "@/lib/map-cache";

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
  bustMapCache(user.id);
  revalidatePath("/tags");
  revalidatePath("/directory");
}

/**
 * Merge several tags into one. Re-points every item_tags link from the source
 * tags to the target (skipping links the item already has on the target), then
 * deletes the source tags. Fixes the auto-tagging near-duplicate problem
 * ("AI" / "ai" / "artificial-intelligence" → one tag).
 */
export async function mergeTagsAction(input: { targetId: string; sourceIds: string[] }) {
  const { user } = await requireUser();
  const sources = input.sourceIds.filter((id) => id !== input.targetId);
  if (sources.length === 0) return { ok: false as const, error: "Pick at least one other tag to merge" };

  // Repoint links to the target; ON CONFLICT keeps the existing (target) link.
  await db.execute(sql`
    update item_tags it
    set tag_id = ${input.targetId}
    where it.user_id = ${user.id}
      and it.tag_id in ${sources}
      and not exists (
        select 1 from item_tags ex
        where ex.user_id = ${user.id}
          and ex.tag_id = ${input.targetId}
          and ex.item_kind = it.item_kind
          and ex.item_id = it.item_id
      )
  `);
  // Drop any leftover source links (the item already had the target tag).
  await db
    .delete(itemTags)
    .where(and(eq(itemTags.userId, user.id), inArray(itemTags.tagId, sources)));
  // Delete the now-empty source tags.
  const deleted = await db
    .delete(tags)
    .where(and(eq(tags.userId, user.id), inArray(tags.id, sources)))
    .returning({ id: tags.id });

  bustMapCache(user.id);
  revalidatePath("/tags");
  revalidatePath("/directory");
  return { ok: true as const, merged: deleted.length };
}

export async function bulkDeleteTagsAction(tagIds: string[]) {
  if (tagIds.length === 0) return { ok: true as const, count: 0 };
  const { user } = await requireUser();
  await db
    .delete(itemTags)
    .where(and(eq(itemTags.userId, user.id), inArray(itemTags.tagId, tagIds)));
  const result = await db
    .delete(tags)
    .where(and(eq(tags.userId, user.id), inArray(tags.id, tagIds)))
    .returning({ id: tags.id });
  bustMapCache(user.id);
  revalidatePath("/tags");
  revalidatePath("/directory");
  return { ok: true as const, count: result.length };
}

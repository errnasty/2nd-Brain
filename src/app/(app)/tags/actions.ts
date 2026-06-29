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

export type DuplicateGroup = { ids: string[]; names: string[]; reason: string };

const normTag = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const singular = (s: string) => (s.endsWith("s") && s.length > 3 ? s.slice(0, -1) : s);

/** Levenshtein edit distance (bounded use — only called on short tag strings). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * #14 Likely-duplicate tags. No tag embeddings exist, so this is a string
 * heuristic (not semantic): tags that collapse to the same normalized form
 * (case/punctuation/plural) are grouped, then near-identical spellings (edit
 * distance ≤ 1) are paired. The user confirms each merge.
 */
export async function findDuplicateTagsAction(): Promise<DuplicateGroup[]> {
  const { user } = await requireUser();
  const all = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, user.id));

  const groups: DuplicateGroup[] = [];
  const grouped = new Set<string>();

  // 1) Exact match after normalization (case / punctuation / trailing plural).
  const byKey = new Map<string, { id: string; name: string }[]>();
  for (const t of all) {
    const key = singular(normTag(t.name));
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(t);
    byKey.set(key, arr);
  }
  for (const arr of byKey.values()) {
    if (arr.length > 1) {
      groups.push({ ids: arr.map((a) => a.id), names: arr.map((a) => a.name), reason: "Same after normalization" });
      for (const a of arr) grouped.add(a.id);
    }
  }

  // 2) Near-identical spelling (edit distance ≤ 1). Capped to keep the O(n²)
  // pass cheap for large tag sets.
  const remaining = all
    .filter((t) => !grouped.has(t.id))
    .map((t) => ({ ...t, n: normTag(t.name) }))
    .filter((t) => t.n.length >= 2)
    .slice(0, 400);
  for (let i = 0; i < remaining.length; i++) {
    if (grouped.has(remaining[i].id)) continue;
    for (let j = i + 1; j < remaining.length; j++) {
      const a = remaining[i], b = remaining[j];
      if (grouped.has(b.id)) continue;
      if (Math.abs(a.n.length - b.n.length) > 1) continue;
      if (levenshtein(a.n, b.n) <= 1) {
        groups.push({ ids: [a.id, b.id], names: [a.name, b.name], reason: "Very similar spelling" });
        grouped.add(a.id);
        grouped.add(b.id);
        break;
      }
    }
  }

  return groups;
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

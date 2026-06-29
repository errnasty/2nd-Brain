"use server";

import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export type AttachableItem = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
};

/**
 * #8 Recent / matching directory items for the "Attach context" picker. Returns
 * the most-recent items, or title matches when a query is given. Capped small —
 * this is a picker, not a browser.
 */
export async function searchAttachableItemsAction(query?: string): Promise<AttachableItem[]> {
  const { user } = await requireUser();
  const q = (query ?? "").trim();
  const where = q
    ? and(eq(directoryItems.userId, user.id), ilike(directoryItems.title, `%${q}%`))
    : eq(directoryItems.userId, user.id);
  const rows = await db
    .select({ id: directoryItems.id, title: directoryItems.title, kind: directoryItems.kind })
    .from(directoryItems)
    .where(where)
    .orderBy(desc(directoryItems.updatedAt))
    .limit(20);
  return rows;
}

"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryItems, directoryTasks, documents } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { toggleTaskInContent } from "@/lib/tasks/parse";
import { syncDirectoryTasks } from "@/lib/tasks/sync";

export type TaskRow = {
  id: string;
  itemId: string;
  itemTitle: string;
  text: string;
  done: boolean;
  dueDate: Date | null;
};

/**
 * The user's tasks with their host item title, for the global view. Ordered
 * open-first then by due date, and capped so a heavy library (many study plans /
 * imported checklists) can't load thousands of rows into the Tasks tab — the cap
 * only sheds the oldest *completed* tasks. (Full open/done/date bucketed paging
 * is a follow-up; see the feasibility notes.)
 */
export async function fetchTasks(userId: string, limit = 1000): Promise<TaskRow[]> {
  const rows = await db
    .select({
      id: directoryTasks.id,
      itemId: directoryTasks.itemId,
      itemTitle: directoryItems.title,
      text: directoryTasks.text,
      done: directoryTasks.done,
      dueDate: directoryTasks.dueDate,
    })
    .from(directoryTasks)
    .innerJoin(directoryItems, eq(directoryItems.id, directoryTasks.itemId))
    .where(eq(directoryTasks.userId, userId))
    .orderBy(
      asc(directoryTasks.done),
      sql`${directoryTasks.dueDate} asc nulls last`,
      asc(directoryTasks.text),
    )
    .limit(limit);
  return rows;
}

const ToggleSchema = z.object({ id: z.string().uuid(), done: z.boolean() });

/**
 * Toggle a task. The source of truth is the host note's markdown, so we rewrite
 * the `[ ]`/`[x]` in the item content and re-sync. If the line has drifted
 * (note edited since extraction) we fall back to flipping just the DB flag.
 */
export async function toggleTaskAction(input: { id: string; done: boolean }) {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { user } = await requireUser();

  const [task] = await db
    .select({
      itemId: directoryTasks.itemId,
      lineIndex: directoryTasks.lineIndex,
      rawLine: directoryTasks.rawLine,
    })
    .from(directoryTasks)
    .where(and(eq(directoryTasks.id, parsed.data.id), eq(directoryTasks.userId, user.id)))
    .limit(1);
  if (!task) return { ok: false as const, error: "Task not found" };

  const [item] = await db
    .select({
      kind: directoryItems.kind,
      content: directoryItems.content,
      documentId: directoryItems.documentId,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, task.itemId), eq(directoryItems.userId, user.id)))
    .limit(1);

  // For uploaded documents the reader renders documents.full_text and
  // directory_items.content is only a 10k preview, so the checkbox must be
  // flipped in full_text — otherwise the document keeps showing the old state.
  const isDoc = item?.kind === "uploaded_document" && !!item.documentId;
  let docFullText: string | null = null;
  if (isDoc) {
    const [doc] = await db
      .select({ fullText: documents.fullText })
      .from(documents)
      .where(and(eq(documents.id, item!.documentId!), eq(documents.userId, user.id)))
      .limit(1);
    docFullText = doc?.fullText ?? null;
  }

  const source = isDoc ? docFullText : item?.content ?? null;
  const newContent =
    source != null
      ? toggleTaskInContent(source, task.lineIndex, task.rawLine, parsed.data.done)
      : null;

  if (newContent != null) {
    if (isDoc) {
      // Update the authoritative document body + keep the item preview in sync.
      // Skip re-chunk/re-embed (unlike a real edit): toggling a checkbox doesn't
      // change what the document means for retrieval.
      await db
        .update(documents)
        .set({ fullText: newContent })
        .where(and(eq(documents.id, item!.documentId!), eq(documents.userId, user.id)));
      await db
        .update(directoryItems)
        .set({ content: newContent.slice(0, 10_000), updatedAt: new Date() })
        .where(and(eq(directoryItems.id, task.itemId), eq(directoryItems.userId, user.id)));
    } else {
      await db
        .update(directoryItems)
        .set({ content: newContent, updatedAt: new Date() })
        .where(and(eq(directoryItems.id, task.itemId), eq(directoryItems.userId, user.id)));
    }
    await syncDirectoryTasks(user.id, task.itemId, newContent);
  } else {
    // Content drifted — keep the views consistent by flipping the flag only.
    await db
      .update(directoryTasks)
      .set({ done: parsed.data.done, updatedAt: new Date() })
      .where(and(eq(directoryTasks.id, parsed.data.id), eq(directoryTasks.userId, user.id)));
  }

  revalidatePath("/tasks");
  revalidatePath("/directory");
  return { ok: true as const };
}

"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { directoryItems, directoryTasks } from "@/lib/db/schema";
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

/** All of the user's tasks with their host item title, for the global view. */
export async function fetchTasks(userId: string): Promise<TaskRow[]> {
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
    );
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
    .select({ content: directoryItems.content })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, task.itemId), eq(directoryItems.userId, user.id)))
    .limit(1);

  const newContent =
    item?.content != null
      ? toggleTaskInContent(item.content, task.lineIndex, task.rawLine, parsed.data.done)
      : null;

  if (newContent != null) {
    await db
      .update(directoryItems)
      .set({ content: newContent, updatedAt: new Date() })
      .where(and(eq(directoryItems.id, task.itemId), eq(directoryItems.userId, user.id)));
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

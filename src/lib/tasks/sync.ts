import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryTasks } from "@/lib/db/schema";
import { parseTasks } from "./parse";

/**
 * Re-materialize a Directory item's markdown tasks: delete its existing rows,
 * re-insert whatever the current content parses to. Idempotent — call after any
 * save of a note/document. Kept server-side (touches db); the parser it uses is
 * pure and lives in ./parse.
 */
export async function syncDirectoryTasks(
  userId: string,
  itemId: string,
  content: string | null,
): Promise<void> {
  const parsed = parseTasks(content);

  await db
    .delete(directoryTasks)
    .where(and(eq(directoryTasks.userId, userId), eq(directoryTasks.itemId, itemId)));

  if (parsed.length === 0) return;

  await db.insert(directoryTasks).values(
    parsed.map((t) => ({
      userId,
      itemId,
      text: t.text,
      done: t.done,
      // Store the date at UTC midnight; the column is timestamptz.
      dueDate: t.dueDate ? new Date(`${t.dueDate}T00:00:00Z`) : null,
      lineIndex: t.lineIndex,
      rawLine: t.rawLine,
    })),
  );
}

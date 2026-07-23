"use server";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  askMessages,
  askThreads,
  type AskMessage,
  type AskSourceRef,
  type AskUsage,
  type AskWebSource,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: AskSourceRef[];
  webSources: AskWebSource[];
  usage: AskUsage | null;
  model: string | null;
};

/** Derive a thread title from the first user message (trimmed). */
function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New conversation";
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** All of the user's threads, most-recently-updated first. */
export async function listThreads(): Promise<ThreadSummary[]> {
  const { user } = await requireUser();
  try {
    const rows = await db
      .select({
        id: askThreads.id,
        title: askThreads.title,
        updatedAt: sql<string>`${askThreads.updatedAt}::text`,
      })
      .from(askThreads)
      .where(eq(askThreads.userId, user.id))
      .orderBy(desc(askThreads.updatedAt))
      .limit(200);
    return rows;
  } catch {
    // A read hiccup / pending migration must not break the Ask page.
    return [];
  }
}

/** One thread's messages in order, or null if not found / not owned. */
export async function loadThread(
  threadId: string,
): Promise<{ id: string; title: string; messages: ThreadMessage[] } | null> {
  const { user } = await requireUser();
  try {
    const [thread] = await db
      .select({ id: askThreads.id, title: askThreads.title })
      .from(askThreads)
      .where(and(eq(askThreads.id, threadId), eq(askThreads.userId, user.id)))
      .limit(1);
    if (!thread) return null;
    const rows = await db
      .select()
      .from(askMessages)
      .where(and(eq(askMessages.threadId, threadId), eq(askMessages.userId, user.id)))
      .orderBy(asc(askMessages.createdAt));
    return { id: thread.id, title: thread.title, messages: rows.map(toThreadMessage) };
  } catch {
    return null;
  }
}

function toThreadMessage(m: AskMessage): ThreadMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    sources: m.sources,
    webSources: m.webSources,
    usage: m.usage,
    model: m.model,
  };
}

/** Create an empty thread and return its id. */
export async function createThread(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { user } = await requireUser();
  try {
    const [row] = await db
      .insert(askThreads)
      .values({ userId: user.id })
      .returning({ id: askThreads.id });
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't start a conversation" };
  }
}

export type AppendMessageInput = {
  threadId: string;
  role: "user" | "assistant";
  content: string;
  sources?: AskSourceRef[];
  webSources?: AskWebSource[];
  usage?: AskUsage | null;
  model?: string | null;
};

/**
 * Append a message to a thread (ownership-checked). The first user message also
 * names the thread; every append bumps the thread's updatedAt so the sidebar
 * re-sorts. Returns the new message id.
 */
export async function appendMessage(
  input: AppendMessageInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { user } = await requireUser();
  try {
    const [thread] = await db
      .select({ id: askThreads.id, title: askThreads.title })
      .from(askThreads)
      .where(and(eq(askThreads.id, input.threadId), eq(askThreads.userId, user.id)))
      .limit(1);
    if (!thread) return { ok: false, error: "Conversation not found" };

    const [row] = await db
      .insert(askMessages)
      .values({
        threadId: input.threadId,
        userId: user.id,
        role: input.role,
        content: input.content,
        sources: input.sources ?? [],
        webSources: input.webSources ?? [],
        usage: input.usage ?? null,
        model: input.model ?? null,
      })
      .returning({ id: askMessages.id });

    // First user message names an untitled thread; always bump updatedAt.
    const shouldTitle =
      input.role === "user" && thread.title === "New conversation" && input.content.trim().length > 0;
    await db
      .update(askThreads)
      .set({ updatedAt: new Date(), ...(shouldTitle ? { title: titleFrom(input.content) } : {}) })
      .where(eq(askThreads.id, input.threadId));

    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the message" };
  }
}

export async function renameThread(threadId: string, title: string) {
  const { user } = await requireUser();
  const clean = title.trim().slice(0, 120) || "New conversation";
  try {
    await db
      .update(askThreads)
      .set({ title: clean, updatedAt: new Date() })
      .where(and(eq(askThreads.id, threadId), eq(askThreads.userId, user.id)));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Couldn't rename" };
  }
}

export async function deleteThread(threadId: string) {
  const { user } = await requireUser();
  try {
    await db
      .delete(askThreads)
      .where(and(eq(askThreads.id, threadId), eq(askThreads.userId, user.id)));
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Couldn't delete" };
  }
}

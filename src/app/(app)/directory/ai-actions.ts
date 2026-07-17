"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { editAssist, type EditAssistMode } from "@/lib/ai/edit-assist";

const EditAssistSchema = z.object({
  mode: z.enum(["rewrite", "summarize", "continue"]),
  selection: z.string().max(4000),
  title: z.string().max(300),
  before: z.string().max(4000),
  after: z.string().max(4000),
});

/**
 * Rewrite/summarize the selected text, or continue writing from the cursor,
 * inside a note being edited. The caller splices the returned text into the
 * textarea itself — this action does not touch the database.
 */
export async function editAssistAction(input: {
  mode: EditAssistMode;
  selection: string;
  title: string;
  before: string;
  after: string;
}) {
  const parsed = EditAssistSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request" };
  await requireUser();

  try {
    const text = await editAssist(parsed.data.mode, parsed.data.selection, {
      title: parsed.data.title,
      before: parsed.data.before,
      after: parsed.data.after,
    });
    if (!text) return { ok: false as const, error: "Couldn't generate a suggestion" };
    return { ok: true as const, text };
  } catch (err) {
    console.error("editAssistAction failed:", err instanceof Error ? err.message : err);
    return { ok: false as const, error: "Couldn't generate a suggestion" };
  }
}

import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { withLiteModel } from "./lite";

/**
 * The model returns a list of commands. Two shapes:
 *  - assign: put an existing item into an existing folder
 *  - create_folder: create a brand-new folder and put a cluster of items in it
 *
 * Important: when create_folder is used, the model must group items that
 * actually belong together — single-item folders are discouraged.
 */
export const OrganizeCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    itemId: z.string(),
    folderName: z.string().describe("Exact folder name from the provided list"),
  }),
  z.object({
    action: z.literal("create_folder"),
    folderName: z
      .string()
      .min(1)
      .max(40)
      .describe("New folder name, 1-3 words, title case, e.g. 'Quantum Computing'"),
    itemIds: z.array(z.string()).min(2).describe("Items to place in this new folder"),
  }),
]);

const OrganizeResponseSchema = z.object({
  commands: z.array(OrganizeCommandSchema),
});

export type OrganizeCommand = z.infer<typeof OrganizeCommandSchema>;

export type OrganizeItem = {
  id: string;
  title: string;
  preview: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
};

const SYSTEM = `You are organizing a user's personal knowledge library.

Given a list of UNCATEGORIZED items and the user's EXISTING folder list, decide
where each item belongs. Two options for each item:

1. ASSIGN to an existing folder when there is a clear fit.
2. CREATE a NEW folder when 2 or more items share a distinct topic that none of
   the existing folders cover.

Rules:
- Prefer existing folders when reasonable.
- Only create a new folder when you have 2+ items that share a distinct topic.
- New folder names: 1-3 words, Title Case (e.g. "Quantum Computing", "ML Papers").
- Never create folders for one-off items — leave them unassigned (no command for that item).
- itemId values MUST be copied exactly from the input.
- folderName for "assign" MUST match an existing folder exactly.

Return only the commands list. Items you don't have confident decisions for
should simply be omitted.`;

export async function organizeItems(
  items: OrganizeItem[],
  existingFolderNames: string[],
): Promise<OrganizeCommand[]> {
  if (!aiAvailable()) return [];
  if (items.length === 0) return [];

  const folderList =
    existingFolderNames.length > 0
      ? existingFolderNames.map((n) => `"${n}"`).join(", ")
      : "(no existing folders yet)";

  const itemList = items
    .map(
      (i, idx) =>
        `${idx + 1}. id=${i.id}\n   kind=${i.kind}\n   title=${i.title}\n   preview=${i.preview.slice(0, 240)}`,
    )
    .join("\n\n");

  try {
    const { object } = await withLiteModel((model) =>
      generateObject({
        model,
      schema: OrganizeResponseSchema,
      system: SYSTEM,
      prompt: `EXISTING FOLDERS: ${folderList}\n\nUNCATEGORIZED ITEMS:\n${itemList}\n\nReturn the commands list.`,
      }),
    );
    return object.commands;
  } catch (err) {
    console.warn("organizeItems failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

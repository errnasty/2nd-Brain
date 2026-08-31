import { z } from "zod";
import { aiAvailable } from "./provider";
import { withLiteModel } from "./lite";
import { generateJson } from "./generate-json";

/**
 * The model returns a list of commands. Two shapes:
 *  - assign: put an existing item into an existing folder
 *  - create_folder: create a brand-new folder and put a cluster of items in it
 *
 * Important: when create_folder is used, the model must group items that
 * actually belong together — single-item folders are discouraged, but NOT
 * rejected by the schema. A library with no folders at all has no other move
 * available, and refusing the command there left every item unsorted with
 * nothing to show for the run.
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
    itemIds: z.array(z.string()).min(1).describe("Items to place in this new folder"),
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

const SYSTEM_TEMPLATE = `You are organizing a user's personal knowledge library.

Given a list of UNCATEGORIZED items and the user's EXISTING folder list, decide
where each item belongs. Two options for each item:

1. ASSIGN to an existing folder when there is a clear fit.
2. CREATE a NEW folder for a topic none of the existing folders cover — see the
   rules below for when that is allowed.

Rules:
- Prefer existing folders when reasonable.
- New folder names: 1-3 words, Title Case (e.g. "Quantum Computing", "ML Papers").
- itemId values MUST be copied exactly from the input.
- folderName for "assign" MUST match an existing folder exactly.
{{SINGLETON_RULE}}

Return only the commands list. Items you don't have confident decisions for
should simply be omitted.`;

/**
 * The clustering rule the prompt gets, which depends on what the user already
 * has. Someone with a shelf of folders is best served by a high bar for new
 * ones — an extra folder per stray item is how a library turns into a mess.
 * Someone with NO folders is served by the opposite: they need a structure to
 * exist before anything can be filed into it, so grouping is still preferred
 * but a single-item folder beats leaving the item homeless.
 */
function singletonRule(hasFolders: boolean): string {
  return hasFolders
    ? `- Only create a new folder when 2+ items share a distinct topic that no existing folder covers.
- Never create folders for one-off items — leave them unassigned (no command for that item).`
    : `- The user has NO folders yet, so you MUST create some: every item should end up in one.
- Group items that share a topic. A folder with a single item is acceptable here
  when nothing else fits it, but prefer a slightly broader folder that catches 2+.
- Aim for a handful of broad, durable folders rather than one folder per item.`;
}

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
    const result = await withLiteModel((model) =>
      generateJson({
        model,
        schema: OrganizeResponseSchema,
        system: SYSTEM_TEMPLATE.replace("{{SINGLETON_RULE}}", singletonRule(existingFolderNames.length > 0)),
        prompt: `EXISTING FOLDERS: ${folderList}\n\nUNCATEGORIZED ITEMS:\n${itemList}\n\nReturn the commands list.`,
      }),
    );
    return result?.commands ?? [];
  } catch (err) {
    console.warn("organizeItems failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Full-library reorganize ──────────────────────────────────────────
//
// A different problem from routing loose items into a shelf that already
// works. Here the shelf itself is the thing being decided, so it is done in
// two passes:
//
//   1. AGREE A STRUCTURE from every title at once. One item at a time can only
//      ever answer "which of these folders is least wrong", which is how a
//      library ends up with "AI", "Machine Learning" and "LLMs" as three
//      sibling folders. Seeing the whole collection is what makes it possible
//      to say those are one folder.
//   2. FILE EACH ITEM into that fixed structure, in batches. Batching is what
//      keeps a 500-item library inside a context window and what gives the
//      progress bar something honest to count — and because the structure was
//      settled in pass 1, batch 7 files into the same folders batch 1 did.

export type LibraryFolder = {
  name: string;
  /** One line on what belongs here — pass 2's only guide to the boundary. */
  description: string;
};

const LibraryPlanSchema = z.object({
  folders: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        description: z.string().max(200),
      }),
    )
    .max(24),
});

const PLAN_SYSTEM = `You design the folder structure for someone's personal knowledge library.

You are given every item's title, and the folders that exist today. Propose the
folder list the whole library SHOULD have.

Rules:
- Between 3 and 15 folders. Fewer, broader folders beat many thin ones.
- KEEP an existing folder name (copied exactly) whenever it still describes a
  real cluster — renaming a folder someone already uses is disruptive.
- MERGE overlapping topics into one folder rather than proposing near-duplicates
  ("AI", "Machine Learning" and "LLMs" are one folder, not three).
- DROP an existing folder from your list if nothing in the library belongs in it
  any more — anything left over is filed elsewhere and the empty folder is tidied
  up afterwards.
- Names: 1-3 words, Title Case.
- Every folder needs a one-line description of what belongs in it.
- Cover the whole library: every item should have somewhere plausible to go.

Return only the folders list.`;

/**
 * Pass 1: propose the folder structure for a whole library from its titles.
 *
 * Titles only, deliberately — the previews that help decide "which of these
 * two folders" are noise when the question is "what shape is this collection",
 * and they would blow the context on a library of any size.
 */
export async function planLibraryFolders(
  titles: string[],
  existingFolderNames: string[],
): Promise<LibraryFolder[]> {
  if (!aiAvailable()) return [];
  if (titles.length === 0) return [];

  const existing =
    existingFolderNames.length > 0
      ? existingFolderNames.map((n) => `"${n}"`).join(", ")
      : "(none yet)";
  const list = titles.map((t, i) => `${i + 1}. ${t.slice(0, 160)}`).join("\n");

  try {
    const result = await withLiteModel((model) =>
      generateJson({
        model,
        schema: LibraryPlanSchema,
        system: PLAN_SYSTEM,
        prompt: `EXISTING FOLDERS: ${existing}\n\nEVERY ITEM IN THE LIBRARY:\n${list}\n\nReturn the folders list.`,
      }),
    );
    // Fold duplicates the model may still emit ("Ai" and "AI"), keeping the
    // first spelling — pass 2 matches on these names.
    const seen = new Set<string>();
    const out: LibraryFolder[] = [];
    for (const f of result?.folders ?? []) {
      const name = f.name.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, description: f.description.trim() });
    }
    return out;
  } catch (err) {
    console.warn("planLibraryFolders failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

const PlacementsSchema = z.object({
  placements: z.array(z.object({ itemId: z.string(), folderName: z.string() })),
});

export type Placement = { itemId: string; folderName: string };

const FILE_SYSTEM = `You file items into a FIXED set of folders.

For each item, pick the single folder it belongs in. The folder structure is
already decided — you may not invent folders.

Rules:
- folderName MUST be copied exactly from the provided folder list.
- itemId MUST be copied exactly from the item.
- Every item should get a placement. Only omit one if it genuinely fits nowhere.
- One placement per item.`;

/**
 * Pass 2: file a batch of items into the agreed structure.
 *
 * Placements naming a folder outside the list are dropped by the caller rather
 * than created: the whole point of fixing the structure first is that pass 2
 * cannot quietly grow it one batch at a time.
 */
export async function assignToFolders(
  items: OrganizeItem[],
  folders: LibraryFolder[],
): Promise<Placement[]> {
  if (!aiAvailable()) return [];
  if (items.length === 0 || folders.length === 0) return [];

  const folderList = folders.map((f) => `- "${f.name}": ${f.description}`).join("\n");
  const itemList = items
    .map((i) => `id=${i.id}\n  kind=${i.kind}\n  title=${i.title}\n  preview=${i.preview.slice(0, 200)}`)
    .join("\n\n");

  try {
    const result = await withLiteModel((model) =>
      generateJson({
        model,
        schema: PlacementsSchema,
        system: FILE_SYSTEM,
        prompt: `FOLDERS:\n${folderList}\n\nITEMS:\n${itemList}\n\nReturn the placements list.`,
      }),
    );
    return result?.placements ?? [];
  } catch (err) {
    console.warn("assignToFolders failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

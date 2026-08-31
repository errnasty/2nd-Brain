/**
 * The Directory's background sort: the thing that actually moves items and
 * folders around once the model has decided where they go.
 *
 * ## Why this is a job and not a server action
 *
 * A tidy-up of a real library is one planning call plus one filing call per
 * batch of items — tens of seconds on a few hundred items, and there is no
 * useful partial answer to show while it runs. Holding a request open for that
 * loses to the first serverless timeout, and holding the UI open for it means
 * the user cannot do anything else with their own app while it happens. So it
 * runs as an `ai_jobs` row: the caller gets a job id immediately, progress is
 * written to the row as each batch lands, and the browser polls it. Closing the
 * dialog, changing page, or reloading does not stop the work.
 *
 * ## Two scopes
 *
 *   - `unsorted` only touches items with no folder. Nothing that is already
 *     filed moves, and no folder is removed. This is the safe, additive run.
 *   - `everything` reconsiders the whole library, including items that are
 *     already in folders, and (when asked) deletes the folders left empty
 *     afterwards. This is the "make it all neater" run.
 *
 * ## What it will never do
 *
 * Delete a folder that still holds items or subfolders, and delete anything at
 * all in `unsorted` scope. Emptying a folder by moving its contents somewhere
 * better is recoverable by dragging them back; deleting a folder someone had
 * put things in is not.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems } from "@/lib/db/schema";
import {
  assignToFolders,
  planLibraryFolders,
  type LibraryFolder,
  type OrganizeItem,
} from "@/lib/ai/organize";
import type {
  OrganizeOptions,
  OrganizeProgress,
  OrganizeScope,
  OrganizeSummary,
  OrganizeUndo,
} from "./organize-plan";

export type {
  OrganizeOptions,
  OrganizeProgress,
  OrganizeScope,
  OrganizeSummary,
  OrganizeUndo,
} from "./organize-plan";
export { describeOrganizeSummary } from "./organize-plan";

/** Items per filing call. Big enough to be cheap, small enough that the
 *  progress bar moves and one bad batch costs little. */
const BATCH = 25;

/** Ceiling on a single run, so one enormous library can't run for an hour. */
const MAX_ITEMS = 600;

/** Content sent to the model per item, in characters. */
const PREVIEW_CHARS = 400;

function norm(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Run a sort to completion, reporting progress as it goes.
 *
 * `onProgress` is awaited so the caller can persist each step (the job row is
 * the only thing the browser can see); it must never throw the run over, so
 * callers keep their own writes fail-soft.
 */
export async function runOrganize(
  userId: string,
  opts: OrganizeOptions,
  onProgress: (p: OrganizeProgress) => Promise<void> | void,
): Promise<OrganizeSummary> {
  const scope = opts.scope;
  const summary: OrganizeSummary = {
    scope,
    moved: 0,
    leftAlone: 0,
    foldersCreated: [],
    foldersRemoved: [],
    undo: { moves: [], createdFolderIds: [], removedFolders: [] },
  };

  await onProgress({ phase: "planning", done: 0, total: 0, label: "Reading your library" });

  const items = await loadItems(userId, scope);
  if (items.length === 0) {
    await onProgress({ phase: "done", done: 0, total: 0, label: "Nothing to sort" });
    return summary;
  }

  // The real, current folders. `is_inbox` is the deprecated tray — it is not
  // part of the structure and must not be proposed, filled or pruned.
  const existing = (
    await db
      .select({
        id: directoryFolders.id,
        name: directoryFolders.name,
        parentId: directoryFolders.parentId,
        isInbox: directoryFolders.isInbox,
      })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, userId))
  ).filter((f) => !f.isInbox);

  await onProgress({
    phase: "planning",
    done: 0,
    total: items.length,
    label: "Deciding on a structure",
  });

  const plan = await planLibraryFolders(
    items.map((i) => i.title),
    existing.map((f) => f.name),
    scope === "everything" ? "reorganize" : "fill",
  );
  if (plan.length === 0) {
    await onProgress({ phase: "done", done: 0, total: items.length, label: "Couldn't plan a structure" });
    return summary;
  }

  // Resolve the plan to real folder ids, creating what doesn't exist. Matching
  // is case-insensitive because the model echoes names back with its own
  // capitalisation, and creating "Ai" beside the user's "AI" is precisely the
  // mess this is supposed to clean up.
  const byName = new Map(existing.map((f) => [norm(f.name), f.id]));
  const folderIds = new Map<string, string>(); // plan name → folder id
  for (const f of plan) {
    const hit = byName.get(norm(f.name));
    if (hit) {
      folderIds.set(norm(f.name), hit);
      continue;
    }
    // `onConflictDoNothing` because (user_id, name) is unique and `existing`
    // above deliberately excludes the deprecated inbox folder: a plan that
    // proposes a name the inbox already holds would otherwise raise a
    // constraint error and fail the entire sort, an hour's work lost to one
    // folder name. The same guard covers a folder created by another device
    // between the read and this write.
    const [row] = await db
      .insert(directoryFolders)
      .values({ userId, name: f.name, parentId: null })
      .onConflictDoNothing({ target: [directoryFolders.userId, directoryFolders.name] })
      .returning({ id: directoryFolders.id });

    if (row) {
      folderIds.set(norm(f.name), row.id);
      byName.set(norm(f.name), row.id);
      summary.foldersCreated.push(f.name);
      summary.undo.createdFolderIds.push(row.id);
      continue;
    }

    // Lost the race, or the name is the inbox's. Either way a folder with this
    // exact name exists — file into it rather than dropping the whole cluster,
    // and do NOT record it as created: the undo must never delete a folder this
    // run did not make.
    const [taken] = await db
      .select({ id: directoryFolders.id })
      .from(directoryFolders)
      .where(and(eq(directoryFolders.userId, userId), eq(directoryFolders.name, f.name)))
      .limit(1);
    if (taken) {
      folderIds.set(norm(f.name), taken.id);
      byName.set(norm(f.name), taken.id);
    }
  }

  const planned: LibraryFolder[] = plan.filter((f) => folderIds.has(norm(f.name)));

  /**
   * The folders pass 2 is allowed to file into.
   *
   * For a whole-library run that is exactly the plan: deciding the shelf is the
   * point, and a folder the plan dropped is one the run intends to empty.
   *
   * For a loose-items run it is the plan PLUS every folder the user already
   * has, because the plan was built from the loose titles alone and cannot
   * speak for folders none of them happen to belong in. Without this, filing a
   * handful of stray articles would quietly restrict the whole library to the
   * three or four folders those articles suggested — and items with a perfectly
   * good existing home would be told there wasn't one.
   */
  const usableFolders: LibraryFolder[] = [...planned];
  if (scope === "unsorted") {
    const named = new Set(planned.map((f) => norm(f.name)));
    for (const f of existing) {
      if (named.has(norm(f.name))) continue;
      folderIds.set(norm(f.name), f.id);
      usableFolders.push({ name: f.name, description: `Existing folder: ${f.name}` });
    }
  }

  // File the items, a batch at a time.
  let filed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await onProgress({
      phase: "filing",
      done: filed,
      total: items.length,
      label: "Filing your items",
    });

    const placements = await assignToFolders(
      batch.map(
        (b): OrganizeItem => ({
          id: b.id,
          title: b.title,
          preview: b.preview ?? "",
          kind: b.kind,
        }),
      ),
      usableFolders,
    );

    // Group this batch's moves by destination so it is one UPDATE per folder
    // rather than one per item.
    const moves = new Map<string, string[]>();
    const placed = new Set<string>();
    const cameFrom = new Map<string, string | null>();
    for (const p of placements) {
      const item = batch.find((b) => b.id === p.itemId);
      const dest = folderIds.get(norm(p.folderName ?? ""));
      // A placement into a folder outside the agreed plan, or for an item that
      // wasn't in this batch, is a model slip — drop it rather than act on it.
      if (!item || !dest) continue;
      placed.add(item.id);
      if (item.folderId === dest) continue; // already exactly where it belongs
      const list = moves.get(dest) ?? [];
      list.push(item.id);
      moves.set(dest, list);
      cameFrom.set(item.id, item.folderId);
    }

    for (const [folderId, itemIds] of moves) {
      const rows = await db
        .update(directoryItems)
        .set({ folderId, updatedAt: new Date() })
        .where(and(eq(directoryItems.userId, userId), inArray(directoryItems.id, itemIds)))
        .returning({ id: directoryItems.id });
      summary.moved += rows.length;
      // Only rows that actually changed hands are recorded, so an undo can
      // never "restore" an item the sort never touched.
      for (const r of rows) {
        summary.undo.moves.push({ itemId: r.id, from: cameFrom.get(r.id) ?? null });
      }
    }
    summary.leftAlone += batch.filter((b) => !placed.has(b.id)).length;

    filed += batch.length;
  }

  await onProgress({ phase: "filing", done: filed, total: items.length, label: "Filing your items" });

  if (scope === "everything" && opts.pruneEmpty) {
    await onProgress({ phase: "tidying", done: filed, total: items.length, label: "Tidying up empty folders" });
    const pruned = await pruneEmptyFolders(userId);

    // A folder this run created and then pruned (the plan proposed it, nothing
    // was filed into it) belongs in neither list: reporting it as both created
    // and removed is just noise, and it has nothing to restore or re-remove on
    // an undo either. Net effect of the run on that folder is nothing, so the
    // summary says nothing about it.
    const bornAndDied = new Set(
      pruned.map((f) => f.id).filter((id) => summary.undo.createdFolderIds.includes(id)),
    );
    const createdIdByName = new Map(pruned.map((f) => [f.id, f.name]));
    if (bornAndDied.size > 0) {
      const names = new Set([...bornAndDied].map((id) => createdIdByName.get(id)));
      summary.foldersCreated = summary.foldersCreated.filter((n) => !names.has(n));
      summary.undo.createdFolderIds = summary.undo.createdFolderIds.filter(
        (id) => !bornAndDied.has(id),
      );
    }

    const survived = pruned.filter((f) => !bornAndDied.has(f.id));
    summary.foldersRemoved = survived.map((f) => f.name);
    summary.undo.removedFolders = survived;
  }

  await onProgress({ phase: "done", done: filed, total: items.length, label: "Done" });
  return summary;
}

type LoadedItem = {
  id: string;
  title: string;
  kind: OrganizeItem["kind"];
  folderId: string | null;
  preview: string | null;
};

/**
 * The items a run considers, newest first so a capped run tidies what the user
 * has actually been collecting rather than an arbitrary slice.
 */
async function loadItems(userId: string, scope: OrganizeScope): Promise<LoadedItem[]> {
  const where =
    scope === "unsorted"
      ? and(eq(directoryItems.userId, userId), isNull(directoryItems.folderId))
      : eq(directoryItems.userId, userId);

  return db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
      folderId: directoryItems.folderId,
      preview: sql<string | null>`substring(${directoryItems.content}, 1, ${PREVIEW_CHARS})`.as("preview"),
    })
    .from(directoryItems)
    .where(where)
    .orderBy(sql`${directoryItems.updatedAt} desc`)
    .limit(MAX_ITEMS);
}

/**
 * Delete folders holding nothing at all: no items, no subfolders.
 *
 * Iterated to a fixed point, because emptying a leaf can leave its parent empty
 * in turn — a three-deep branch nobody uses any more should go in one run, not
 * over three separate sorts. The loop is bounded: every pass either deletes
 * something or stops.
 */
async function pruneEmptyFolders(
  userId: string,
): Promise<{ id: string; name: string; parentId: string | null }[]> {
  const removed: { id: string; name: string; parentId: string | null }[] = [];

  for (let pass = 0; pass < 8; pass += 1) {
    const folders = (
      await db
        .select({
          id: directoryFolders.id,
          name: directoryFolders.name,
          parentId: directoryFolders.parentId,
          isInbox: directoryFolders.isInbox,
        })
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, userId))
    ).filter((f) => !f.isInbox);
    if (folders.length === 0) break;

    const counts = await db
      .select({ folderId: directoryItems.folderId, n: sql<number>`count(*)::int` })
      .from(directoryItems)
      .where(eq(directoryItems.userId, userId))
      .groupBy(directoryItems.folderId);
    const itemCount = new Map(counts.map((c) => [c.folderId ?? "", c.n]));
    const hasChild = new Set(folders.map((f) => f.parentId).filter((p): p is string => !!p));

    const empty = folders.filter((f) => (itemCount.get(f.id) ?? 0) === 0 && !hasChild.has(f.id));
    if (empty.length === 0) break;

    await db.delete(directoryFolders).where(
      and(
        eq(directoryFolders.userId, userId),
        inArray(
          directoryFolders.id,
          empty.map((f) => f.id),
        ),
      ),
    );
    removed.push(...empty.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })));
  }

  return removed;
}

/**
 * Put the library back exactly as it was before a sort.
 *
 * Order matters, and it is the reverse of the run:
 *
 *   1. Recreate the folders the sort tidied away, under their original ids —
 *      because step 2 may need to send an item back into one of them.
 *   2. Move every item the sort moved back where it came from.
 *   3. Remove the folders the sort created, but ONLY the ones now empty. A
 *      folder the user has since filed something into by hand is theirs now;
 *      deleting it would undo their work as well as ours.
 *
 * Idempotent: running it twice restores nothing the second time (the moves no
 * longer differ, the folders already exist) rather than doing damage. Every
 * step is scoped to `userId`, so a stolen job id reaches nothing.
 */
export async function undoOrganize(
  userId: string,
  undo: OrganizeUndo,
): Promise<{ restored: number; foldersRestored: number; foldersRemoved: number }> {
  let foldersRestored = 0;
  if (undo.removedFolders.length > 0) {
    // Re-parent to root anything whose parent is itself gone — a restored
    // folder hanging off a missing id would vanish from the tree.
    const alive = new Set(
      (
        await db
          .select({ id: directoryFolders.id })
          .from(directoryFolders)
          .where(eq(directoryFolders.userId, userId))
      ).map((f) => f.id),
    );
    const restoring = new Set(undo.removedFolders.map((f) => f.id));
    const rows = await db
      .insert(directoryFolders)
      .values(
        undo.removedFolders.map((f) => ({
          id: f.id,
          userId,
          name: f.name,
          parentId: f.parentId && (alive.has(f.parentId) || restoring.has(f.parentId)) ? f.parentId : null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: directoryFolders.id });
    foldersRestored = rows.length;
  }

  // Which folders exist RIGHT NOW, after the restore above. An item whose old
  // home is still missing — its restore lost a name collision, or someone
  // deleted the folder by hand since the sort — goes back to unsorted rather
  // than into a folder id that no longer exists, which would fail the foreign
  // key and take the whole undo down with it.
  const live = new Set(
    (
      await db
        .select({ id: directoryFolders.id })
        .from(directoryFolders)
        .where(eq(directoryFolders.userId, userId))
    ).map((f) => f.id),
  );

  // Group by destination so this is one UPDATE per original folder.
  const byFolder = new Map<string | null, string[]>();
  for (const m of undo.moves) {
    const dest = m.from && live.has(m.from) ? m.from : null;
    const list = byFolder.get(dest) ?? [];
    list.push(m.itemId);
    byFolder.set(dest, list);
  }
  let restored = 0;
  for (const [folderId, itemIds] of byFolder) {
    for (let i = 0; i < itemIds.length; i += 200) {
      const rows = await db
        .update(directoryItems)
        .set({ folderId, updatedAt: new Date() })
        .where(and(eq(directoryItems.userId, userId), inArray(directoryItems.id, itemIds.slice(i, i + 200))))
        .returning({ id: directoryItems.id });
      restored += rows.length;
    }
  }

  let foldersRemoved = 0;
  if (undo.createdFolderIds.length > 0) {
    const counts = await db
      .select({ folderId: directoryItems.folderId, n: sql<number>`count(*)::int` })
      .from(directoryItems)
      .where(and(eq(directoryItems.userId, userId), inArray(directoryItems.folderId, undo.createdFolderIds)))
      .groupBy(directoryItems.folderId);
    const occupied = new Set(counts.filter((c) => c.n > 0).map((c) => c.folderId));
    const children = await db
      .select({ parentId: directoryFolders.parentId })
      .from(directoryFolders)
      .where(and(eq(directoryFolders.userId, userId), inArray(directoryFolders.parentId, undo.createdFolderIds)));
    for (const c of children) if (c.parentId) occupied.add(c.parentId);

    const removable = undo.createdFolderIds.filter((id) => !occupied.has(id));
    if (removable.length > 0) {
      const rows = await db
        .delete(directoryFolders)
        .where(and(eq(directoryFolders.userId, userId), inArray(directoryFolders.id, removable)))
        .returning({ id: directoryFolders.id });
      foldersRemoved = rows.length;
    }
  }

  return { restored, foldersRestored, foldersRemoved };
}

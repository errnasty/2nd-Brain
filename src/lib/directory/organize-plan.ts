/**
 * The vocabulary of a Directory sort: what it was asked to do, how far it has
 * got, what it did, and how to put it back.
 *
 * Separate from the sort itself because these types travel further than the
 * code that produces them. The job row's payload is typed with them (`schema.ts`),
 * the browser's progress strip and completion toast read them, and the pure
 * summary line below is rendered on both sides. Everything in `organize.ts`
 * pulls in the database; nothing here does, so importing a summary type into a
 * client component costs the bundle nothing.
 */

export type OrganizeScope = "unsorted" | "everything";

export type OrganizeOptions = {
  scope: OrganizeScope;
  /** `everything` only: remove folders left empty by the sort. */
  pruneEmpty?: boolean;
};

/** What the status strip renders while the job runs. */
export type OrganizeProgress = {
  phase: "planning" | "filing" | "tidying" | "done";
  /** Items filed so far. Meaningless while `total` is 0. */
  done: number;
  total: number;
  label: string;
};

export type OrganizeSummary = {
  scope: OrganizeScope;
  /** Items that ended up somewhere different from where they started. */
  moved: number;
  /** Items the model had no confident home for. */
  leftAlone: number;
  foldersCreated: string[];
  foldersRemoved: string[];
  /** Everything needed to put the library back exactly as it was. */
  undo: OrganizeUndo;
};

/**
 * The reversal record for one sort.
 *
 * Written as the run goes rather than diffed afterwards, because "where was
 * this item before" is knowledge the run has and nothing else can recover: once
 * an item has moved, its old folder is simply not written down anywhere.
 *
 * Folders are recorded by id, and a removed folder is restored under its
 * ORIGINAL id — so an item whose previous home was tidied away has somewhere
 * real to go back to, and any other row still pointing at that id (a sync peer
 * that had not caught up, say) lines up again rather than dangling.
 */
export type OrganizeUndo = {
  /** Every item the sort moved, and the folder it came from (null = unsorted). */
  moves: { itemId: string; from: string | null }[];
  /** Folders the sort created, to remove again if they end up empty. */
  createdFolderIds: string[];
  /** Folders the sort deleted, with enough to recreate them as they were. */
  removedFolders: { id: string; name: string; parentId: string | null }[];
};

/** One line for the toast that lands when the job finishes. */
export function describeOrganizeSummary(s: OrganizeSummary): string {
  const parts: string[] = [];
  parts.push(`${s.moved} item${s.moved === 1 ? "" : "s"} filed`);
  if (s.foldersCreated.length > 0) {
    parts.push(`${s.foldersCreated.length} new folder${s.foldersCreated.length === 1 ? "" : "s"}`);
  }
  if (s.foldersRemoved.length > 0) {
    parts.push(`${s.foldersRemoved.length} empty folder${s.foldersRemoved.length === 1 ? "" : "s"} removed`);
  }
  if (s.leftAlone > 0) parts.push(`${s.leftAlone} left where they were`);
  return parts.join(" · ");
}

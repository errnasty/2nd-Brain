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
  /** What actually moved, in words, for the report. */
  report: OrganizeReport;
};

/**
 * The human-readable record of a sort: what went where, and what didn't move.
 *
 * Separate from the undo record even though the two describe the same events.
 * The undo record is ids — the only thing a reversal can safely act on, since
 * a folder can be renamed between the sort and the undo. This is names and
 * titles as they were AT THE TIME, which is what a person needs to recognise
 * their own library, and which stays readable after the undo record has been
 * spent and cleared.
 *
 * Counts alone were not enough. "40 items filed" tells you a sort happened; it
 * does not tell you whether it put your tax documents in "Machine Learning",
 * which is the only question anyone actually has afterwards.
 */
export type OrganizeReport = {
  /** Every move: what it was called, where it came from, where it went. */
  moves: { title: string; from: string | null; to: string }[];
  /** Items the model had no confident home for, left where they were. */
  unplaced: string[];
};

/** Titles are for recognition, not for reading. Long ones are cut. */
export const REPORT_TITLE_CHARS = 120;

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

/**
 * The summary minus its undo record — what is safe and sensible to send to a
 * browser.
 *
 * The undo record is a list of every item the sort moved and where it came
 * from: up to six hundred id pairs, tens of kilobytes, and of no use whatsoever
 * to the page, which only ever renders counts and a button. It is polled every
 * two seconds while a sort runs, so shipping it would mean re-sending the
 * entire move list on the tick the job finishes. The undo itself is applied
 * server-side from the job row, so the browser needs the job id and nothing
 * else.
 */
export type PublicOrganizeSummary = Omit<OrganizeSummary, "undo" | "report"> & {
  canUndo: boolean;
  /** Whether there is a per-item report worth opening. */
  hasReport: boolean;
};

export function publicSummary(s: OrganizeSummary): PublicOrganizeSummary {
  const { undo, report, ...rest } = s;
  return {
    ...rest,
    canUndo: undo.moves.length > 0 || undo.removedFolders.length > 0,
    // Optional-chained because a summary written before reports existed has no
    // `report` at all, and this is read straight off a stored jsonb payload —
    // an older run must degrade to "no report to show", not throw on the poll
    // that reports the sort finished.
    hasReport: (report?.moves.length ?? 0) > 0 || (report?.unplaced.length ?? 0) > 0,
  };
}

/** One line for the toast that lands when the job finishes. */
export function describeOrganizeSummary(
  s: Omit<OrganizeSummary, "undo" | "report">,
): string {
  const parts: string[] = [];
  // Skipped when nothing moved AND something else did happen, so a run that
  // only tidied folders reads "2 empty folders removed" rather than leading
  // with "0 items filed".
  const onlyFolders = s.moved === 0 && (s.foldersCreated.length > 0 || s.foldersRemoved.length > 0);
  if (!onlyFolders) parts.push(`${s.moved} item${s.moved === 1 ? "" : "s"} filed`);
  if (s.foldersCreated.length > 0) {
    parts.push(`${s.foldersCreated.length} new folder${s.foldersCreated.length === 1 ? "" : "s"}`);
  }
  if (s.foldersRemoved.length > 0) {
    parts.push(`${s.foldersRemoved.length} empty folder${s.foldersRemoved.length === 1 ? "" : "s"} removed`);
  }
  if (s.leftAlone > 0) parts.push(`${s.leftAlone} left where they were`);
  return parts.join(" · ");
}

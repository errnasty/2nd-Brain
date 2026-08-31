import { describe, expect, it } from "vitest";
import { describeOrganizeSummary, publicSummary, type OrganizeSummary } from "./organize-plan";

const base: OrganizeSummary = {
  scope: "everything",
  moved: 0,
  leftAlone: 0,
  foldersCreated: [],
  foldersRemoved: [],
  undo: { moves: [], createdFolderIds: [], removedFolders: [] },
  report: { moves: [], unplaced: [] },
};

describe("describeOrganizeSummary", () => {
  it("always says how many items were filed", () => {
    expect(describeOrganizeSummary({ ...base, moved: 12 })).toBe("12 items filed");
  });

  it("gets the singular right", () => {
    expect(describeOrganizeSummary({ ...base, moved: 1 })).toBe("1 item filed");
    expect(describeOrganizeSummary({ ...base, moved: 3, foldersCreated: ["Physics"] })).toContain(
      "1 new folder",
    );
  });

  it("reports created and removed folders separately", () => {
    const line = describeOrganizeSummary({
      ...base,
      moved: 40,
      foldersCreated: ["Physics", "Biology"],
      foldersRemoved: ["Old Stuff"],
    });
    expect(line).toBe("40 items filed · 2 new folders · 1 empty folder removed");
  });

  // Silence about the items nothing was confident about reads as "everything
  // was handled", which is the one thing the summary must not imply.
  it("mentions items it left alone", () => {
    expect(describeOrganizeSummary({ ...base, moved: 5, leftAlone: 2 })).toContain(
      "2 left where they were",
    );
  });

  it("says nothing about folders when none changed", () => {
    expect(describeOrganizeSummary({ ...base, moved: 5 })).toBe("5 items filed");
  });

  // A tidy-up that only removed empty folders did do something; leading with
  // "0 items filed" reads as if it did nothing.
  it("leads with the folders when nothing moved", () => {
    expect(describeOrganizeSummary({ ...base, moved: 0, foldersRemoved: ["Old", "Older"] })).toBe(
      "2 empty folders removed",
    );
  });

  it("still says zero when nothing at all happened", () => {
    expect(describeOrganizeSummary(base)).toBe("0 items filed");
  });
});

describe("publicSummary", () => {
  const withUndo: OrganizeSummary = {
    ...base,
    moved: 3,
    undo: {
      moves: [{ itemId: "a", from: null }],
      createdFolderIds: ["f1"],
      removedFolders: [],
    },
  };

  // The undo record is a list of every item the sort moved. It is polled every
  // two seconds and is of no use to a page that renders counts and a button.
  it("strips the undo record", () => {
    const out = publicSummary(withUndo);
    expect(out).not.toHaveProperty("undo");
    expect(out.moved).toBe(3);
  });

  it("reports whether there is a per-item breakdown worth opening", () => {
    expect(publicSummary(base).hasReport).toBe(false);
    expect(
      publicSummary({ ...base, report: { moves: [{ title: "A", from: null, to: "Physics" }], unplaced: [] } })
        .hasReport,
    ).toBe(true);
    // A run that placed nothing still has something to show: which items it
    // could not find a home for.
    expect(publicSummary({ ...base, report: { moves: [], unplaced: ["A"] } }).hasReport).toBe(true);
  });

  // Runs stored before reports existed have no `report` key at all, and this
  // reads straight off a jsonb payload.
  it("survives a summary written before reports existed", () => {
    const legacy = { ...base } as Partial<OrganizeSummary>;
    delete legacy.report;
    expect(publicSummary(legacy as OrganizeSummary).hasReport).toBe(false);
  });

  it("strips the report as well as the undo record", () => {
    const out = publicSummary({
      ...base,
      report: { moves: [{ title: "A", from: null, to: "Physics" }], unplaced: [] },
    });
    expect(out).not.toHaveProperty("report");
  });

  it("reports whether there is anything to put back", () => {
    expect(publicSummary(withUndo).canUndo).toBe(true);
    expect(publicSummary(base).canUndo).toBe(false);
    // A sort that only removed folders is still undoable — the folders come back.
    expect(
      publicSummary({
        ...base,
        undo: { moves: [], createdFolderIds: [], removedFolders: [{ id: "f", name: "F", parentId: null }] },
      }).canUndo,
    ).toBe(true);
    // Created folders alone are not: with nothing moved into them, undoing
    // would only delete folders, which is not what "put it back" means.
    expect(
      publicSummary({
        ...base,
        undo: { moves: [], createdFolderIds: ["f1"], removedFolders: [] },
      }).canUndo,
    ).toBe(false);
  });
});

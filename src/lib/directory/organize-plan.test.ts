import { describe, expect, it } from "vitest";
import { describeOrganizeSummary, type OrganizeSummary } from "./organize-plan";

const base: OrganizeSummary = {
  scope: "everything",
  moved: 0,
  leftAlone: 0,
  foldersCreated: [],
  foldersRemoved: [],
  undo: { moves: [], createdFolderIds: [], removedFolders: [] },
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
});

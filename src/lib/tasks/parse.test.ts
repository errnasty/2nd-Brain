import { describe, it, expect } from "vitest";
import { parseTasks, toggleTaskInContent } from "./parse";

describe("parseTasks", () => {
  it("returns nothing for empty/blank content", () => {
    expect(parseTasks("")).toEqual([]);
    expect(parseTasks(null)).toEqual([]);
    expect(parseTasks("just some prose\nno tasks here")).toEqual([]);
  });

  it("parses unfinished and finished checkboxes with list markers", () => {
    const md = "- [ ] buy milk\n- [x] call alice\n* [X] ship it\n+ [ ] write tests";
    const tasks = parseTasks(md);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ text: "buy milk", done: false, lineIndex: 0 });
    expect(tasks[1]).toMatchObject({ text: "call alice", done: true, lineIndex: 1 });
    expect(tasks[2]).toMatchObject({ text: "ship it", done: true });
    expect(tasks[3]).toMatchObject({ text: "write tests", done: false });
  });

  it("parses checkboxes without a list marker", () => {
    const tasks = parseTasks("[ ] standalone task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("standalone task");
  });

  it("extracts a (due: YYYY-MM-DD) annotation and strips it from text", () => {
    const tasks = parseTasks("- [ ] finish report (due: 2026-06-30)");
    expect(tasks[0].text).toBe("finish report");
    expect(tasks[0].dueDate).toBe("2026-06-30");
  });

  it("keeps dueDate null when no annotation", () => {
    expect(parseTasks("- [ ] no date")[0].dueDate).toBeNull();
  });

  it("preserves the raw line and index for round-tripping", () => {
    const md = "intro\n  - [ ] indented task";
    const t = parseTasks(md)[0];
    expect(t.lineIndex).toBe(1);
    expect(t.rawLine).toBe("  - [ ] indented task");
  });

  it("skips empty checkboxes", () => {
    expect(parseTasks("- [ ] ")).toEqual([]);
  });
});

describe("toggleTaskInContent", () => {
  const md = "- [ ] task one\n- [x] task two";

  it("marks an unfinished task done", () => {
    const out = toggleTaskInContent(md, 0, "- [ ] task one", true);
    expect(out).toBe("- [x] task one\n- [x] task two");
  });

  it("marks a finished task undone", () => {
    const out = toggleTaskInContent(md, 1, "- [x] task two", false);
    expect(out).toBe("- [ ] task one\n- [ ] task two");
  });

  it("returns null if the raw line no longer matches (content drifted)", () => {
    expect(toggleTaskInContent(md, 0, "- [ ] DIFFERENT", true)).toBeNull();
  });

  it("returns null for out-of-range index", () => {
    expect(toggleTaskInContent(md, 99, "x", true)).toBeNull();
  });
});

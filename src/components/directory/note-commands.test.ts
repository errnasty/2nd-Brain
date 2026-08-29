import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  cycleHeading,
  insertLink,
  toggleBullet,
  toggleQuote,
  toggleTaskLine,
  toggleWrap,
} from "./note-commands";

/**
 * The commands only ever touch `view.state` and `view.dispatch`, so a stub is
 * enough to exercise them without a DOM.
 */
function run(
  cmd: (view: EditorView) => boolean,
  doc: string,
  from = 0,
  to = from,
): { doc: string; cursor: number } {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  let next = state;
  const view = {
    state,
    dispatch: (spec: TransactionSpec) => {
      next = state.update(spec).state;
    },
  } as unknown as EditorView;
  cmd(view);
  return { doc: next.doc.toString(), cursor: next.selection.main.head };
}

describe("toggleWrap", () => {
  const bold = toggleWrap("**");

  it("wraps a selection and keeps it selected", () => {
    const state = EditorState.create({ doc: "make me bold", selection: EditorSelection.single(8, 12) });
    let next = state;
    bold({ state, dispatch: (s: TransactionSpec) => (next = state.update(s).state) } as unknown as EditorView);
    expect(next.doc.toString()).toBe("make me **bold**");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("bold");
  });

  it("unwraps when the markers are inside the selection", () => {
    expect(run(bold, "a **b** c", 2, 7).doc).toBe("a b c");
  });

  it("unwraps when the markers hug the selection", () => {
    expect(run(bold, "a **b** c", 4, 5).doc).toBe("a b c");
  });

  it("leaves the cursor between the markers when nothing is selected", () => {
    expect(run(bold, "ab", 1)).toEqual({ doc: "a****b", cursor: 3 });
  });

  it("works for other wrappers", () => {
    expect(run(toggleWrap("_"), "hi there", 3, 8).doc).toBe("hi _there_");
    expect(run(toggleWrap("`"), "run x", 4, 5).doc).toBe("run `x`");
  });
});

describe("insertLink", () => {
  it("wraps selected text and parks the cursor in the empty URL", () => {
    const { doc, cursor } = run(insertLink, "see the docs", 8, 12);
    expect(doc).toBe("see the [docs]()");
    expect(cursor).toBe(15);
  });

  it("treats a selected URL as the target and parks the cursor in the label", () => {
    const { doc, cursor } = run(insertLink, "https://example.com", 0, 19);
    expect(doc).toBe("[](https://example.com)");
    expect(cursor).toBe(1);
  });

  it("inserts an empty link when nothing is selected", () => {
    expect(run(insertLink, "", 0).doc).toBe("[]()");
  });
});

describe("toggleBullet", () => {
  it("adds and removes a bullet on one line", () => {
    expect(run(toggleBullet, "one", 0).doc).toBe("- one");
    expect(run(toggleBullet, "- one", 2).doc).toBe("one");
  });

  it("preserves indentation", () => {
    expect(run(toggleBullet, "    one", 4).doc).toBe("    - one");
  });

  it("levels a mixed selection up rather than half-clearing it", () => {
    const doc = ["- one", "two"].join("\n");
    expect(run(toggleBullet, doc, 0, doc.length).doc).toBe(["- - one", "- two"].join("\n"));
  });

  it("removes only when every line already has one", () => {
    const doc = ["- one", "- two"].join("\n");
    expect(run(toggleBullet, doc, 0, doc.length).doc).toBe(["one", "two"].join("\n"));
  });

  it("does not strip the bullet off a checklist item", () => {
    expect(run(toggleBullet, "- [ ] task", 0).doc).toBe("- - [ ] task");
  });

  it("ignores blank lines when deciding to strip", () => {
    const doc = ["- one", "", "- two"].join("\n");
    expect(run(toggleBullet, doc, 0, doc.length).doc).toBe(["one", "", "two"].join("\n"));
  });
});

describe("toggleTaskLine", () => {
  it("adds and removes a checklist marker", () => {
    expect(run(toggleTaskLine, "task", 0).doc).toBe("- [ ] task");
    expect(run(toggleTaskLine, "- [ ] task", 0).doc).toBe("task");
  });

  it("removes a ticked item too", () => {
    expect(run(toggleTaskLine, "- [x] task", 0).doc).toBe("task");
  });
});

describe("toggleQuote", () => {
  it("adds and removes across a selection", () => {
    const doc = ["one", "two"].join("\n");
    expect(run(toggleQuote, doc, 0, doc.length).doc).toBe(["> one", "> two"].join("\n"));
    const quoted = ["> one", "> two"].join("\n");
    expect(run(toggleQuote, quoted, 0, quoted.length).doc).toBe(["one", "two"].join("\n"));
  });
});

describe("cycleHeading", () => {
  it("steps none → # → ## → ### → none", () => {
    expect(run(cycleHeading, "title", 0).doc).toBe("# title");
    expect(run(cycleHeading, "# title", 0).doc).toBe("## title");
    expect(run(cycleHeading, "## title", 0).doc).toBe("### title");
    expect(run(cycleHeading, "### title", 0).doc).toBe("title");
  });

  it("only touches the line the cursor is on", () => {
    const doc = ["one", "two"].join("\n");
    expect(run(cycleHeading, doc, 4).doc).toBe(["one", "# two"].join("\n"));
  });

  it("ignores a hash with no space after it", () => {
    expect(run(cycleHeading, "#nope", 0).doc).toBe("# #nope");
  });
});

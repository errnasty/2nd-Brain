import type { EditorView } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import { startCompletion } from "@codemirror/autocomplete";

/**
 * Markdown editing commands, shared by the desktop keymap and the mobile
 * formatting bar — a phone has no ⌘B, so the same command has to be reachable
 * from a button.
 *
 * Every command edits the document as plain text. None of them reformat
 * anything they were not asked to touch.
 */

/** Toggle a symmetric wrapper (`**`, `_`, `` ` ``) around the selection. */
export function toggleWrap(before: string, after = before) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const r = state.selection.main;
    const bLen = before.length;
    const aLen = after.length;
    const selected = state.sliceDoc(r.from, r.to);

    // Markers inside the selection → unwrap.
    if (selected.length >= bLen + aLen && selected.startsWith(before) && selected.endsWith(after)) {
      const inner = selected.slice(bLen, selected.length - aLen);
      view.dispatch({
        changes: { from: r.from, to: r.to, insert: inner },
        selection: { anchor: r.from, head: r.from + inner.length },
        userEvent: "input",
      });
      return true;
    }

    // Markers hugging the selection → unwrap those instead.
    const outerBefore = state.sliceDoc(Math.max(0, r.from - bLen), r.from);
    const outerAfter = state.sliceDoc(r.to, Math.min(state.doc.length, r.to + aLen));
    if (outerBefore === before && outerAfter === after) {
      view.dispatch({
        changes: [
          { from: r.from - bLen, to: r.from },
          { from: r.to, to: r.to + aLen },
        ],
        selection: { anchor: r.from - bLen, head: r.to - bLen },
        userEvent: "input",
      });
      return true;
    }

    view.dispatch({
      changes: [
        { from: r.from, insert: before },
        { from: r.to, insert: after },
      ],
      selection: r.empty ? { anchor: r.from + bLen } : { anchor: r.from + bLen, head: r.to + bLen },
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  };
}

/** Wrap the selection as a link, cursor left where you'd type next. */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const selected = state.sliceDoc(r.from, r.to).trim();
  const looksLikeUrl = /^(https?:\/\/|mailto:)\S+$/i.test(selected);
  const text = looksLikeUrl ? "" : selected;
  const url = looksLikeUrl ? selected : "";
  const insert = `[${text}](${url})`;
  // Into the empty half: the URL when we already have text, the text otherwise.
  const anchor = looksLikeUrl ? r.from + 1 : r.from + text.length + 3;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** Start a `[[wikilink]]` and open the title picker. */
export function insertWikilink(view: EditorView): boolean {
  const r = view.state.selection.main;
  const selected = view.state.sliceDoc(r.from, r.to);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: `[[${selected}]]` },
    selection: { anchor: r.from + 2 + selected.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  startCompletion(view);
  return true;
}

/**
 * Add or strip a line marker (`- `, `- [ ] `, `> `) across the selected lines.
 * Strips only when every line already carries it, so a mixed selection gets
 * levelled up rather than half-cleared.
 *
 * `matcher` must capture the indent as group 1 and the marker as group 2.
 */
export function toggleLinePrefix(prefix: string, matcher: RegExp) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const r = state.selection.main;
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;

    const all = [];
    for (let n = first; n <= last; n++) all.push(state.doc.line(n));
    // Blank lines inside a selection shouldn't veto the "all have it" test.
    const nonBlank = all.filter((l) => l.text.trim().length > 0);
    const lines = nonBlank.length > 0 ? nonBlank : all;

    const strip = lines.every((l) => matcher.test(l.text));
    const changes = lines.map((l) => {
      const m = matcher.exec(l.text);
      if (strip && m) {
        const from = l.from + m[1].length;
        return { from, to: from + m[2].length, insert: "" };
      }
      const indent = /^\s*/.exec(l.text)?.[0] ?? "";
      return { from: l.from + indent.length, insert: prefix };
    });

    view.dispatch({ changes, userEvent: "input" });
    return true;
  };
}

export const BULLET_RE = /^(\s*)([-*+] )(?!\[[ xX]\] )/;
export const TASK_RE = /^(\s*)([-*+] \[[ xX]\] )/;
export const QUOTE_RE = /^(\s*)(> )/;

export const toggleBullet = toggleLinePrefix("- ", BULLET_RE);
export const toggleTaskLine = toggleLinePrefix("- [ ] ", TASK_RE);
export const toggleQuote = toggleLinePrefix("> ", QUOTE_RE);

/** Step the current line's heading level: none → # → ## → ### → none. */
export function cycleHeading(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const m = /^(#{1,6}) /.exec(line.text);
  const insert = !m ? "# " : m[1].length >= 3 ? "" : `${"#".repeat(m[1].length + 1)} `;
  view.dispatch({
    changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert },
    userEvent: "input",
  });
  return true;
}

const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Tab indents list items. Outside a list with no selection it does nothing, so
 *  Tab still moves focus out of the editor for keyboard users. */
export function tabIndent(view: EditorView): boolean {
  const r = view.state.selection.main;
  if (r.empty && !LIST_LINE_RE.test(view.state.doc.lineAt(r.head).text)) return false;
  return indentMore(view);
}

export function shiftTabIndent(view: EditorView): boolean {
  const r = view.state.selection.main;
  if (r.empty && !LIST_LINE_RE.test(view.state.doc.lineAt(r.head).text)) return false;
  return indentLess(view);
}

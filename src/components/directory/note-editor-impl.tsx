"use client";

import { useEffect, useRef } from "react";
import { EditorState, Prec, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  autocompletion,
  closeBrackets,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import type { NoteEditorProps, TitleSuggestion } from "./note-editor";

/* ── Live preview ─────────────────────────────────────────────────────
   Obsidian-style: the document is always literal markdown (that text is what
   gets stored, embedded and exported), but the syntax markers are visually
   replaced on every line the cursor is NOT on. Put the cursor on a line and
   its raw markdown reappears, so nothing is ever hidden from editing.
   ──────────────────────────────────────────────────────────────────── */

const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g;

/** Inline marks that carry no meaning once rendered. */
const INLINE_MARKS = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "LinkMark"]);

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const deco: Range<Decoration>[] = [];

  // Lines the caret touches keep their raw markdown. When the editor is
  // unfocused every line renders, so a note at rest reads like a document.
  const active = new Set<number>();
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      const first = state.doc.lineAt(r.from).number;
      const last = state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) active.add(n);
    }
  }
  const lineOf = (pos: number) => state.doc.lineAt(pos).number;
  const revealed = (pos: number) => active.has(lineOf(pos));

  // A line can sit inside nested blockquotes; only decorate it once per class.
  const lineClasses = new Set<string>();
  const addLineClass = (pos: number, cls: string) => {
    const line = state.doc.lineAt(pos);
    const key = `${line.number}:${cls}`;
    if (lineClasses.has(key)) return;
    lineClasses.add(key);
    deco.push(Decoration.line({ class: cls }).range(line.from));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          addLineClass(node.from, `cm-md-h${heading[1]}`);
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          const first = lineOf(node.from);
          const last = lineOf(Math.min(node.to, state.doc.length));
          for (let n = first; n <= last; n++) addLineClass(state.doc.line(n).from, "cm-md-code-line");
          return;
        }

        if (name === "Blockquote") {
          const first = lineOf(node.from);
          const last = lineOf(Math.min(node.to, state.doc.length));
          for (let n = first; n <= last; n++) addLineClass(state.doc.line(n).from, "cm-md-quote-line");
          return;
        }

        if (name === "HorizontalRule") {
          addLineClass(node.from, "cm-md-rule-line");
          return;
        }

        if (INLINE_MARKS.has(name)) {
          if (revealed(node.from)) return;
          let end = node.to;
          if (name === "HeaderMark") {
            // The mark is just the `#`s — swallow the space after it too, or
            // hiding it leaves the heading indented by one space.
            const line = state.doc.lineAt(node.from);
            while (end < line.to && state.doc.sliceString(end, end + 1) === " ") end++;
          }
          if (end > node.from) deco.push(Decoration.replace({}).range(node.from, end));
          return;
        }

        // `(url)` of an inline link — but never an autolink's URL, where the
        // URL *is* the visible text.
        if (name === "URL" && node.node.parent?.name === "Link") {
          if (!revealed(node.from)) deco.push(Decoration.replace({}).range(node.from, node.to));
          return;
        }

        // Backticks only for inline code; a fence's ``` must stay on screen or
        // the code block collapses into a blank line.
        if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          if (!revealed(node.from)) deco.push(Decoration.replace({}).range(node.from, node.to));
          return;
        }
      },
    });

    // Wikilinks are ours, not CommonMark — lezer never sees them, so scan the
    // visible lines directly.
    const firstLine = lineOf(from);
    const lastLine = lineOf(to);
    for (let n = firstLine; n <= lastLine; n++) {
      const line = state.doc.line(n);
      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(line.text)) !== null) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        deco.push(Decoration.mark({ class: "cm-md-wikilink" }).range(start, end));
        if (active.has(n)) continue;
        deco.push(Decoration.replace({}).range(start, start + 2));
        if (m[2] !== undefined) {
          // `[[Target|alias]]` renders as just the alias.
          const pipe = m[0].indexOf("|");
          deco.push(Decoration.replace({}).range(start + 2, start + pipe + 1));
        }
        deco.push(Decoration.replace({}).range(end - 2, end));
      }
    }
  }

  return Decoration.set(deco, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/* ── Formatting commands ─────────────────────────────────────────────── */

/** Toggle a symmetric wrapper (`**`, `_`, `` ` ``) around the selection. */
function toggleWrap(before: string, after = before) {
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
      selection: r.empty
        ? { anchor: r.from + bLen }
        : { anchor: r.from + bLen, head: r.to + bLen },
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  };
}

/** Cmd/Ctrl+K — wrap the selection as a link, cursor left where you'd type. */
function insertLink(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const selected = state.sliceDoc(r.from, r.to).trim();
  const looksLikeUrl = /^(https?:\/\/|mailto:)\S+$/i.test(selected);
  const text = looksLikeUrl ? "" : selected;
  const url = looksLikeUrl ? selected : "";
  const insert = `[${text}](${url})`;
  // Cursor into the empty half: the URL when we have text, the text otherwise.
  const anchor = looksLikeUrl ? r.from + 1 : r.from + text.length + 3;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** Cmd/Ctrl+Shift+K — start a `[[wikilink]]` and open the title picker. */
function insertWikilink(view: EditorView): boolean {
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

const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Tab indents list items. Outside a list with no selection it does nothing,
 *  so Tab still moves focus out of the editor for keyboard users. */
function tabIndent(view: EditorView): boolean {
  const r = view.state.selection.main;
  const line = view.state.doc.lineAt(r.head);
  if (r.empty && !LIST_LINE_RE.test(line.text)) return false;
  return indentMore(view);
}

function shiftTabIndent(view: EditorView): boolean {
  const r = view.state.selection.main;
  const line = view.state.doc.lineAt(r.head);
  if (r.empty && !LIST_LINE_RE.test(line.text)) return false;
  return indentLess(view);
}

/* ── Wikilink autocomplete ───────────────────────────────────────────── */

function wikilinkCompletions(
  fetchTitles: () => NoteEditorProps["searchTitles"],
): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  return async (ctx) => {
    const token = ctx.matchBefore(/\[\[[^\]\n]*$/);
    if (!token) return null;
    const query = token.text.slice(2);
    if (!ctx.explicit && query.length === 0 && token.from + 2 !== ctx.pos) return null;

    let results: TitleSuggestion[] = [];
    try {
      results = await fetchTitles()(query);
    } catch {
      return null;
    }
    if (ctx.aborted) return null;

    const options: Completion[] = results.map((r) => ({
      label: r.title,
      type: r.kind === "user_note" ? "text" : "constant",
      detail: r.kind === "saved_article" ? "article" : r.kind === "uploaded_document" ? "doc" : undefined,
      apply: (view, _c, from, to) => {
        // Swallow a `]]` the user already typed rather than doubling it.
        const trailing = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2)) === "]]" ? 2 : 0;
        view.dispatch({
          changes: { from, to: to + trailing, insert: `${r.title}]]` },
          selection: { anchor: from + r.title.length + 2 },
          userEvent: "input.complete",
        });
      },
    }));

    return { from: token.from + 2, options, validFor: /^[^\]\n]*$/ };
  };
}

/* ── Theme ───────────────────────────────────────────────────────────── */

const highlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "hsl(var(--muted-foreground))" },
  { tag: [t.link, t.url], color: "hsl(var(--brand, var(--primary)))" },
  { tag: t.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.875em" },
  { tag: t.quote, color: "hsl(var(--muted-foreground))" },
  { tag: [t.list, t.processingInstruction], color: "hsl(var(--muted-foreground))" },
  { tag: t.heading, fontWeight: "700" },
  { tag: t.contentSeparator, color: "hsl(var(--muted-foreground))" },
]);

const theme = EditorView.theme({
  "&": {
    color: "hsl(var(--foreground))",
    backgroundColor: "transparent",
    fontSize: "16px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--app-font-body, ui-sans-serif), system-ui, sans-serif",
    lineHeight: "1.6",
    overflow: "visible",
  },
  ".cm-content": { padding: "0", caretColor: "hsl(var(--foreground))" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "hsl(var(--muted-foreground))", fontStyle: "italic" },

  // Headings — sizes track .prose-note so edit and preview agree.
  ".cm-line.cm-md-h1": { fontSize: "1.5em", fontWeight: "700", lineHeight: "1.25", marginTop: "0.9em" },
  ".cm-line.cm-md-h2": { fontSize: "1.25em", fontWeight: "650", lineHeight: "1.3", marginTop: "0.8em" },
  ".cm-line.cm-md-h3": { fontSize: "1.05em", fontWeight: "650", marginTop: "0.7em" },
  ".cm-line.cm-md-h4, .cm-line.cm-md-h5, .cm-line.cm-md-h6": { fontWeight: "650" },

  ".cm-line.cm-md-code-line": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.85em",
    backgroundColor: "hsl(var(--muted))",
  },
  ".cm-line.cm-md-quote-line": {
    borderLeft: "3px solid hsl(var(--border))",
    paddingLeft: "0.75rem",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-line.cm-md-rule-line": { color: "hsl(var(--muted-foreground))" },

  ".cm-md-wikilink": {
    color: "hsl(var(--brand, var(--primary)))",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    textDecorationColor: "hsl(var(--border))",
  },

  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--popover, var(--background)))",
    borderRadius: "0.5rem",
    boxShadow: "0 8px 24px hsl(0 0% 0% / 0.12)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--app-font-body, ui-sans-serif), system-ui, sans-serif",
    fontSize: "13px",
    maxHeight: "16rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 10px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "hsl(var(--accent))",
    color: "hsl(var(--accent-foreground))",
  },
  ".cm-completionDetail": { color: "hsl(var(--muted-foreground))", fontStyle: "normal", marginLeft: "0.5rem" },
});

/* ── Component ───────────────────────────────────────────────────────── */

export default function NoteEditorImpl({
  value,
  onChange,
  onSelectionChange,
  searchTitles,
  placeholder,
  autoFocus = false,
  className,
}: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Callbacks live in refs so a re-render never tears down the editor (which
  // would lose undo history, scroll position and the caret).
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const searchTitlesRef = useRef(searchTitles);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  searchTitlesRef.current = searchTitles;

  useEffect(() => {
    if (!hostRef.current) return;

    const extensions: Extension[] = [
      history(),
      indentUnit.of("  "),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, addKeymap: false }),
      syntaxHighlighting(highlight),
      livePreview,
      closeBrackets(),
      autocompletion({
        override: [wikilinkCompletions(() => searchTitlesRef.current)],
        icons: false,
        defaultKeymap: true,
      }),
      Prec.highest(
        keymap.of([
          { key: "Enter", run: insertNewlineContinueMarkup },
          { key: "Mod-b", run: toggleWrap("**"), preventDefault: true },
          { key: "Mod-i", run: toggleWrap("_"), preventDefault: true },
          { key: "Mod-e", run: toggleWrap("`"), preventDefault: true },
          { key: "Mod-k", run: insertLink, preventDefault: true },
          { key: "Mod-Shift-k", run: insertWikilink, preventDefault: true },
          { key: "Tab", run: tabIndent },
          { key: "Shift-Tab", run: shiftTabIndent },
        ]),
      ),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) {
          const r = u.state.selection.main;
          onSelectionChangeRef.current?.({ start: r.from, end: r.to });
        }
      }),
    ];
    if (placeholder) extensions.push(cmPlaceholder(placeholder));

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mount. `value` is synced by the effect below; rebuilding
    // on every keystroke would destroy undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt changes made outside the editor (AI rewrite/summarize/continue,
  // switching to a different note). Typing does not reach here: the value prop
  // already equals the document by the time React re-renders.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    // Park the caret at the end of whatever actually changed, so an AI insert
    // leaves you where the new text stops rather than at position 0.
    let prefix = 0;
    const max = Math.min(current.length, value.length);
    while (prefix < max && current[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < max - prefix &&
      current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) {
      suffix++;
    }
    const anchor = Math.max(0, Math.min(value.length, value.length - suffix));

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor },
    });
  }, [value]);

  return <div ref={hostRef} className={className} />;
}

// Pure markdown checkbox task extractor. Db-free + runtime-free so it can be
// unit-tested and later reused in a local/offline build (Phase 4.3).

export type ParsedTask = {
  /** Display text, with the trailing `(due: …)` stripped out. */
  text: string;
  done: boolean;
  /** ISO date `YYYY-MM-DD` if a `(due: …)` was present, else null. */
  dueDate: string | null;
  /** 0-based line number in the source content. */
  lineIndex: number;
  /** The exact source line, used to locate + rewrite the checkbox later. */
  rawLine: string;
};

// A markdown checkbox line: optional indent, optional list marker (-, *, +),
// then [ ] / [x] / [X], then the task text.
const CHECKBOX_RE = /^(\s*)(?:[-*+]\s+)?\[([ xX])\]\s+(.+?)\s*$/;
// Trailing due-date annotation, e.g. "(due: 2026-06-30)".
const DUE_RE = /\(due:\s*(\d{4}-\d{2}-\d{2})\)/i;

/** Extract every markdown checkbox task from a content string. */
export function parseTasks(content: string | null | undefined): ParsedTask[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const tasks: ParsedTask[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;

    const done = m[2].toLowerCase() === "x";
    let text = m[3];

    let dueDate: string | null = null;
    const due = DUE_RE.exec(text);
    if (due) {
      dueDate = due[1];
      text = text.replace(DUE_RE, "").replace(/\s+/g, " ").trim();
    }

    if (!text) continue; // empty checkbox — skip
    tasks.push({ text, done, dueDate, lineIndex: i, rawLine: line });
  }

  return tasks;
}

/**
 * Flip a single checkbox in the source content. Locates the line by index and
 * verifies it still matches the expected raw line (guards against the note
 * having changed since extraction). Returns the new content, or null if the
 * line no longer matches.
 */
export function toggleTaskInContent(
  content: string,
  lineIndex: number,
  rawLine: string,
  done: boolean,
): string | null {
  const lines = content.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  if (lines[lineIndex] !== rawLine) return null;

  const m = CHECKBOX_RE.exec(lines[lineIndex]);
  if (!m) return null;

  // Replace just the [ ]/[x] marker, preserving indent + marker + text.
  lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}

/**
 * The reader's typography: typeface, line spacing and margins.
 *
 * Pure and dependency-free so both halves of the reader can share it — the
 * server page that reads the stored preference and the client that renders
 * from it — and so the values can be unit-tested rather than trusted.
 *
 * These three live on the ACCOUNT, not on the book, unlike type size and page
 * colour which are stored per book. The distinction is what each setting is
 * actually about: type size is a response to this book's typesetting, whereas
 * line spacing, margins and typeface are a response to the reader's own eyes,
 * and asking for them again on every new book would be tedious.
 *
 * Every value is validated on read. The settings blob is jsonb written by a
 * shallow merge, so nothing upstream can promise these fields are the right
 * shape — and a bad line height reaches CSS as a book that cannot be read.
 */

export type BookFont = "serif" | "sans";
export type BookMargin = "narrow" | "normal" | "wide";

export type BookTypography = {
  font: BookFont;
  lineHeight: number;
  margin: BookMargin;
};

export const BOOK_TYPOGRAPHY_DEFAULT: BookTypography = {
  font: "serif",
  // The value the reader shipped with, so an account that never touches the
  // panel renders exactly as it did before the setting existed.
  lineHeight: 1.65,
  margin: "normal",
};

/** Line spacing steps, tight → airy. Anything outside this is rejected. */
export const LINE_HEIGHT_STEPS: { value: number; label: string }[] = [
  { value: 1.4, label: "Tight" },
  { value: 1.65, label: "Normal" },
  { value: 1.9, label: "Relaxed" },
  { value: 2.15, label: "Airy" },
];

/**
 * Side margins, as the gutter either side of the text.
 *
 * Each is a `clamp()` rather than a fixed length, because the right gutter is
 * not one number: 56px either side of a phone screen leaves a column too
 * narrow to read, and 20px either side of a desktop window leaves a line so
 * long the eye loses its place on the return sweep. The reader's setting picks
 * a BAND — how generous to be — and the viewport picks the value inside it.
 *
 * "Normal" is deliberately the band the reader shipped with before this was a
 * setting (roughly 20px on a phone, 56px on a desktop), so an account that
 * never opens the panel sees the page it has always seen.
 */
export const MARGIN_STEPS: { value: BookMargin; label: string; css: string }[] = [
  { value: "narrow", label: "Narrow", css: "clamp(0.5rem, 2vw, 1.5rem)" },
  { value: "normal", label: "Normal", css: "clamp(1.25rem, 5vw, 3.5rem)" },
  { value: "wide", label: "Wide", css: "clamp(2rem, 9vw, 7rem)" },
];

export const FONT_STACKS: Record<BookFont, string> = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  sans: '"Helvetica Neue", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** The CSS length for a margin setting. Falls back to "normal". */
export function marginCss(margin: BookMargin): string {
  return (
    MARGIN_STEPS.find((m) => m.value === margin)?.css ??
    MARGIN_STEPS[1].css
  );
}

/**
 * Coerce whatever is in the settings blob into a usable set of values.
 *
 * Deliberately forgiving rather than strict: a stray key is a reason to fall
 * back to the default for that one field, never a reason to fail to open a
 * book. A line height is snapped to the nearest offered step so a hand-edited
 * 0.2 cannot render a book as overlapping lines.
 */
export function resolveTypography(stored: unknown): BookTypography {
  const raw = (stored ?? {}) as Record<string, unknown>;

  const font: BookFont = raw.font === "sans" ? "sans" : "serif";
  const margin: BookMargin =
    raw.margin === "narrow" || raw.margin === "wide" ? raw.margin : "normal";

  let lineHeight = BOOK_TYPOGRAPHY_DEFAULT.lineHeight;
  if (typeof raw.lineHeight === "number" && Number.isFinite(raw.lineHeight)) {
    const nearest = LINE_HEIGHT_STEPS.reduce((best, step) =>
      Math.abs(step.value - (raw.lineHeight as number)) < Math.abs(best.value - (raw.lineHeight as number))
        ? step
        : best,
    );
    lineHeight = nearest.value;
  }

  return { font, lineHeight, margin };
}

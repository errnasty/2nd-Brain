// Minimal RFC 4180 CSV writer — pure, no deps, so it's unit-testable without
// hitting an authed route. Used by the flashcard export (Anki imports CSV with
// a front/back/deck column mapping).

/** Escape one field: quote it if it contains a comma, quote, or newline, and
 *  double any embedded quotes. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

export function toCsv(rows: string[][]): string {
  return rows.map(csvRow).join("\r\n");
}

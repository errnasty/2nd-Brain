import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Interpolating a JS Date into a raw sql`` template does not work. Inside the
// query builder drizzle has the column's type to encode against, but in a raw
// template it has nothing, so postgres-js is handed the Date object itself and
// throws:
//
//   The "string" argument must be of type string or an instance of Buffer or
//   ArrayBuffer. Received an instance of Date
//
// Every such query in this codebase sits behind a try/catch that logs and
// carries on, so the symptom is not an error page — it is a feature quietly
// doing nothing. purgeOldReadArticles was exactly this: the retention purge
// threw on every single run and deleted nothing, for as long as it had existed.
//
// Pass `date.toISOString()` instead (or use the query builder, which encodes
// via the column).

const SRC = join(process.cwd(), "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

// A `new Date(...)` whose result is immediately converted is NOT a Date any
// more — `new Date(x).toISOString()` is the fix, not the bug.
const CONVERTED = /\.\s*(toISOString|toJSON|getTime|valueOf|toString|toLocaleDateString|toDateString)\s*\(/;

/** Identifiers in `src` that hold a Date, by the ways this codebase makes one. */
function dateIdentifiers(src: string): Set<string> {
  const names = new Set<string>();
  // Assignments: read the whole initializer so a trailing conversion is seen.
  // The initializer must BE a Date expression, not merely contain one —
  // `dayKey(new Date())` returns a string and is not what this is looking for.
  for (const m of src.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    const [, name, init] = m;
    if (/^new Date\(/.test(init.trim()) && !CONVERTED.test(init)) names.add(name);
  }
  // Declared Date params and fields, incl. `now: Date = new Date()`.
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Date\b/g)) names.add(m[1]);
  return names;
}

/** `${ident}` interpolations inside every sql`…` template, with line numbers. */
function sqlInterpolations(src: string): Array<{ ident: string; line: number }> {
  const out: Array<{ ident: string; line: number }> = [];
  for (const m of src.matchAll(/sql`((?:[^`\\]|\\.)*)`/gs)) {
    const line = src.slice(0, m.index).split("\n").length;
    for (const i of m[1].matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
      out.push({ ident: i[1], line });
    }
  }
  return out;
}

describe("no raw Date is bound into a sql`` template", () => {
  it("every date-valued interpolation is converted to a string first", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("sql`")) continue;
      const dates = dateIdentifiers(src);
      if (dates.size === 0) continue;
      for (const { ident, line } of sqlInterpolations(src)) {
        if (dates.has(ident)) {
          offenders.push(`${relative(process.cwd(), file)}:${line} → \${${ident}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the detector actually detects the shape it is guarding against", () => {
    const sample = [
      "const cutoff = new Date();",
      "await db.execute(sql`delete from articles where created_at < ${cutoff}`);",
    ].join("\n");
    expect(dateIdentifiers(sample).has("cutoff")).toBe(true);
    expect(sqlInterpolations(sample).map((i) => i.ident)).toContain("cutoff");
  });

  it("does not flag a date that was converted to a string", () => {
    for (const sample of [
      // separate conversion…
      "const d = new Date();\nconst iso = d.toISOString();\nsql`where x < ${iso}`",
      // …and the chained form purgeOldReadArticles actually uses.
      "const cutoff = new Date(Date.now() - 1).toISOString();\nsql`where x < ${cutoff}`",
      // A helper that takes a Date and returns a string is not a Date either.
      "const today = dayKey(new Date());\nsql`where key = ${today}`",
    ]) {
      const dates = dateIdentifiers(sample);
      const used = sqlInterpolations(sample).map((i) => i.ident);
      expect(used.filter((u) => dates.has(u)), sample).toEqual([]);
    }
  });
});

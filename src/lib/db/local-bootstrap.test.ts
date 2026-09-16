import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "src/lib/db/local-bootstrap.ts"), "utf8");

/** The `client.exec(X_SQL)` blocks, in the order ensureLocalSchema runs them. */
function execOrder(): string[] {
  const body = src.slice(src.indexOf("export async function ensureLocalSchema"));
  return [...body.matchAll(/client\.exec\(([A-Z_]+_SQL)\)/g)].map((m) => m[1]);
}

/** The body of a `const X_SQL = \`…\`` block. */
function block(name: string): string {
  const m = src.match(new RegExp(`const ${name} = \\\`([\\s\\S]*?)\\\`;`));
  if (!m) throw new Error(`no ${name} block found`);
  return m[1];
}

// ensureLocalSchema wraps every step in try/catch-and-warn, so a step that runs
// before its dependency does not fail the launch — it just leaves the desktop
// database incomplete and prints a line nobody reads.
//
// That is what happened here: PERF_INDEX_SQL indexes `articles.trend_score`,
// which TRENDING_SQL adds, and TRENDING_SQL ran afterwards. PGlite aborted the
// whole PERF_INDEX_SQL batch at the first offending statement and rolled it
// back, so desktop had NONE of the nine feeds/directory indexes and no
// directory_items.preview column.
describe("ensureLocalSchema step order", () => {
  it("adds trending columns before indexing them", () => {
    const order = execOrder();
    expect(order).toContain("TRENDING_SQL");
    expect(order).toContain("PERF_INDEX_SQL");
    expect(order.indexOf("TRENDING_SQL")).toBeLessThan(order.indexOf("PERF_INDEX_SQL"));
  });

  it("every column a later block indexes is added by an earlier one", () => {
    const order = execOrder();
    // Columns added by each block, as `alter table … add column [if not exists] X`.
    const addedBy = new Map<string, number>();
    order.forEach((name, i) => {
      for (const m of block(name).matchAll(
        /alter table\s+(\w+)\s+add column\s+(?:if not exists\s+)?(\w+)/gi,
      )) {
        const key = `${m[1]}.${m[2]}`;
        if (!addedBy.has(key)) addedBy.set(key, i);
      }
    });

    const problems: string[] = [];
    order.forEach((name, i) => {
      for (const m of block(name).matchAll(/create index[^;]*?\son\s+(\w+)\s*\(([^)]*)\)/gis)) {
        const table = m[1];
        for (const col of m[2].split(",").map((c) => c.trim().split(/\s+/)[0])) {
          const addedAt = addedBy.get(`${table}.${col}`);
          if (addedAt !== undefined && addedAt > i) {
            problems.push(`${name} indexes ${table}.${col}, added later by ${order[addedAt]}`);
          }
        }
      }
    });
    expect(problems).toEqual([]);
  });
});

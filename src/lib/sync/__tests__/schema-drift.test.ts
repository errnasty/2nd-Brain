import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();

const engineSrc = readFileSync(resolve(repo, "src/lib/sync/engine.ts"), "utf8");
const bootstrapSrc = readFileSync(resolve(repo, "src/lib/db/local-bootstrap.ts"), "utf8");
const localSchemaSrc = readFileSync(resolve(repo, "src/lib/db/local-schema.ts"), "utf8");

// Tables the SYNC ENGINE expects to exist locally (engine.ts: TABLES).
function tablesFromEngine(): string[] {
  const m = engineSrc.match(/const TABLES:\s*TableCfg\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!m) throw new Error("Could not find TABLES in engine.ts");
  const body = m[1];
  const names: string[] = [];
  const re = /name:\s*"([a-z_]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(body))) names.push(mm[1]);
  return names;
}

// Split the combined bootstrap + generated local-schema source into individual
// SQL statements (terminated by `;`) and return, for each table name, the DDL
// text of its CREATE TABLE (so we can assert a column is present in that table's
// definition, not just anywhere in the file).
function createTableDdl(table: string): string | null {
  const combined = `${bootstrapSrc}\n${localSchemaSrc}`;
  const statements = combined.split(";");
  for (const stmt of statements) {
    const create = new RegExp(`create table (if not exists )?["']?${table}["']?`, "i").test(stmt);
    if (create) return stmt;
  }
  return null;
}

describe("desktop local-schema stays in sync with the sync engine's TABLES", () => {
  const tables = tablesFromEngine();

  it("covers every synced table with a CREATE TABLE", () => {
    for (const t of tables) {
      const ddl = createTableDdl(t);
      expect(ddl, `table ${t} (in engine.ts TABLES) is missing from local-bootstrap/local-schema`).not.toBeNull();
    }
  });

  it("gives every synced table an updated_at column (sync engine throws at engine.ts:171 without it)", () => {
    for (const t of tables) {
      const ddl = createTableDdl(t);
      expect(ddl, `no CREATE TABLE found for ${t}`).not.toBeNull();
      // Column may come from the CREATE TABLE body OR a later
      // `alter table <t> add column if not exists updated_at` (the bootstrap
      // upgrade path for pre-sync local DBs). Either satisfies the invariant.
      const hasInCreate = /"updated_at"|updated_at\b/i.test(ddl ?? "");
      const hasInAlter = new RegExp(`alter table ${t}\\s+add column if not exists updated_at`, "i").test(
        `${bootstrapSrc}\n${localSchemaSrc}`,
      );
      expect(hasInCreate || hasInAlter, `updated_at missing on ${t}`).toBe(true);
    }
  });

  it("creates the sync cursor + conflict tables", () => {
    expect(bootstrapSrc.includes("create table if not exists sync_tombstones")).toBe(true);
    expect(bootstrapSrc.includes("create table if not exists sync_meta")).toBe(true);
    expect(bootstrapSrc.includes("create table if not exists sync_conflicts")).toBe(true);
  });
});

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { articleEmbeddings, directoryItems, documentChunks } from "@/lib/db/schema";
import { EMBEDDING_SQL_TYPE, embeddingParam } from "./index";
import { EMBEDDING_TABLES } from "./tables";

const toSQL = (q: SQL) => new PgDialect().sqlToQuery(q);

// Regression guard for the "column embedding does not exist" class of bug:
// if a table declares an `embedding` column in the Drizzle schema, that table
// MUST be in EMBEDDING_TABLES so ensureVectorSchema creates the column +
// index. Adding embedding to a new table without updating the list fails here.
describe("vector schema drift", () => {
  const candidates = [documentChunks, articleEmbeddings, directoryItems];

  it("every schema table with an embedding column is covered by ensureVectorSchema", () => {
    for (const table of candidates) {
      const cols = getTableColumns(table);
      if ("embedding" in cols) {
        expect(EMBEDDING_TABLES).toContain(getTableName(table));
      }
    }
  });

  it("directory_items has an embedding column (notes RAG depends on it)", () => {
    expect("embedding" in getTableColumns(directoryItems)).toBe(true);
    expect(EMBEDDING_TABLES).toContain("directory_items");
  });
});

// The stored column type and the cast applied to every QUERY vector have to
// agree: pgvector has no `halfvec <=> vector` operator, so a mismatch is a
// hard runtime failure on every semantic search, not a quiet degradation.
describe("embedding column type", () => {
  const candidates = [documentChunks, articleEmbeddings, directoryItems];

  it("every embedding column is the type embeddingParam casts to", () => {
    for (const table of candidates) {
      const col = getTableColumns(table).embedding;
      expect(col.getSQLType()).toBe(EMBEDDING_SQL_TYPE);
    }
  });

  it("is halfvec, not fp32 vector — see migration 0037", () => {
    expect(EMBEDDING_SQL_TYPE).toBe("halfvec(1024)");
  });

  it("embeddingParam casts the bound query vector to that same type", () => {
    const { sql: text } = toSQL(embeddingParam([0.1, 0.2]));
    expect(text).toBe(`$1::${EMBEDDING_SQL_TYPE}`);
  });
});

// Guard against a stale fp32 cast reappearing: it would compile, pass review as
// a no-op diff, and fail only when a user runs a search. Assembled rather than
// written out so this file doesn't match its own search.
describe("no fp32 casts left in source", () => {
  it("nothing under src/ casts a query vector to the old fp32 type", () => {
    const pattern = `${"::"}vector`;
    // git grep exits 1 with no output when there are no matches — the passing
    // case here — so read `status` rather than letting a throw stand in for it.
    const res = spawnSync("git", ["grep", "-l", "--", pattern, "src"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(res.status, res.stderr).toBeLessThan(2);
    const offenders = (res.stdout ?? "").split("\n").filter(Boolean);
    expect(offenders).toEqual([]);
  });
});

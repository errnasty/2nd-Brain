import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { articleEmbeddings, directoryItems, documentChunks } from "@/lib/db/schema";
import { EMBEDDING_TABLES } from "./tables";

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

// Tables that carry a pgvector `embedding halfvec(1024)` column. Single source
// of truth shared by ensureVectorSchema (which creates them) and the
// schema-drift test (which asserts the Drizzle schema doesn't declare an
// embedding column on a table missing from this list). No db import here so
// tests can load it without DATABASE_URL.
export const EMBEDDING_TABLES = [
  "document_chunks",
  "article_embeddings",
  "directory_items",
] as const;

export type EmbeddingTable = (typeof EMBEDDING_TABLES)[number];

/**
 * Which of them carry an HNSW index, and why `article_embeddings` does not.
 *
 * An HNSW element tuple embeds the whole vector, and at 2056 bytes only three
 * fit an 8 KB index page — so the index costs roughly as much as the vectors it
 * indexes. Measured on a 20k-row fixture: 51 MB of index against 54 MB of table.
 *
 * For `article_embeddings` that is not worth it. Every query against it is
 * per-user (`where user_id = …`), which HNSW cannot use — it searches the whole
 * graph and filters afterwards — and with the expiry policy in policy.ts the
 * table stays small enough that an exact scan is comfortably fast. Exact search
 * is also, by definition, more accurate than the approximate graph it replaces.
 *
 * `document_chunks` and `directory_items` keep theirs: a single book can add
 * thousands of chunks, and neither has an expiry policy.
 *
 * See migration 0038.
 */
export const ANN_INDEXED_TABLES: readonly EmbeddingTable[] = [
  "document_chunks",
  "directory_items",
];

export function hasAnnIndex(table: EmbeddingTable): boolean {
  return ANN_INDEXED_TABLES.includes(table);
}

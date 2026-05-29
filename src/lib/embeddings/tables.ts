// Tables that carry a pgvector `embedding vector(1024)` column. Single source
// of truth shared by ensureVectorSchema (which creates them) and the
// schema-drift test (which asserts the Drizzle schema doesn't declare an
// embedding column on a table missing from this list). No db import here so
// tests can load it without DATABASE_URL.
export const EMBEDDING_TABLES = [
  "document_chunks",
  "article_embeddings",
  "directory_items",
] as const;

-- Add an embedding column to directory_items so user-written notes (which
-- have no underlying document/article row) can participate in the Ask RAG
-- retrieval. Documents and saved articles continue to be embedded via their
-- existing document_chunks / article_embeddings tables.
--
-- 1024 dims to match the rest of the schema (matches Voyage native dims).

alter table directory_items
  add column if not exists embedding vector(1024);

create index if not exists directory_items_embedding_idx
  on directory_items using hnsw (embedding vector_cosine_ops);

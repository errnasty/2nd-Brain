-- Migrate embedding columns from 1536 dims (OpenAI native) to 1024 dims
-- (Voyage native, also accepted by OpenAI via the `dimensions` parameter).
--
-- Run this once in the Supabase SQL Editor BEFORE running the backfill.
-- It is safe because no embeddings have been generated yet — both columns are
-- entirely NULL until you POST to /api/embeddings/backfill.

drop index if exists document_chunks_embedding_idx;
drop index if exists article_embeddings_embedding_idx;

alter table document_chunks alter column embedding type vector(1024);
alter table article_embeddings alter column embedding type vector(1024);

create index document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

create index article_embeddings_embedding_idx
  on article_embeddings using hnsw (embedding vector_cosine_ops);

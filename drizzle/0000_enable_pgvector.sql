-- Run this BEFORE the first `drizzle-kit push` / generated migration.
-- It enables the pgvector extension required by document_chunks.embedding
-- and article_embeddings.embedding.
--
-- On Supabase, you can also enable this via Dashboard > Database > Extensions.
CREATE EXTENSION IF NOT EXISTS vector;

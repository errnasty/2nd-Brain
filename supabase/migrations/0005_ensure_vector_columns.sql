-- ─────────────────────────────────────────────────────────────────────
-- Migration 0005 — self-healing vector schema + sync lock
--
-- Run this if RAG/Ask fails with: column "embedding" does not exist.
-- It is fully idempotent — safe to run any number of times. It guarantees:
--   • pgvector extension is enabled
--   • every table that needs an embedding column has one (vector(1024))
--   • the HNSW cosine indexes exist
--   • profiles has the is_syncing lock columns
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists vector;

-- document_chunks.embedding (uploaded documents)
alter table document_chunks   add column if not exists embedding vector(1024);
-- article_embeddings.embedding (saved/RSS articles)
alter table article_embeddings add column if not exists embedding vector(1024);
-- directory_items.embedding (user notes — added in 0004; re-asserted here)
alter table directory_items   add column if not exists embedding vector(1024);

create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists article_embeddings_embedding_idx
  on article_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists directory_items_embedding_idx
  on directory_items using hnsw (embedding vector_cosine_ops);

-- Sync lock columns on profiles (used to block concurrent feed syncs)
alter table profiles add column if not exists is_syncing boolean not null default false;
alter table profiles add column if not exists sync_started_at timestamptz;

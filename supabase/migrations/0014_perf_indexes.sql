-- Phase 2 audit: missing supporting indexes for tenant-filtered retrieval and
-- tag filtering. Both are CREATE INDEX IF NOT EXISTS so this is safe to re-run.
-- CONCURRENTLY so it doesn't lock the tables on a live DB.

-- RAG/related queries filter article_embeddings by user_id (then rank by the
-- HNSW vector index). The user_id predicate had no supporting index.
create index concurrently if not exists article_embeddings_user_idx
  on article_embeddings (user_id);

-- Directory tag-filter + export queries filter by (user_id, item_kind, tag_id)
-- and group by item_id. The existing indexes were split (user_id alone; or
-- item_kind+item_id), forcing extra work. This composite matches the shape.
create index concurrently if not exists item_tags_user_kind_tag_idx
  on item_tags (user_id, item_kind, tag_id, item_id);

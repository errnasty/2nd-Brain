-- ─────────────────────────────────────────────────────────────────────
-- What is each article embedding actually buying?
--
-- Read-only and fast; safe in the Supabase SQL editor.
--
-- Exactly four things read article_embeddings, and they want different rows:
--
--   Ask / RAG          src/lib/ai/rag.ts       ONLY articles saved to the
--                                              Directory (it inner-joins
--                                              directory_items kind='saved_article')
--   Trending / brief   src/lib/trending/       ONLY the last 48 hours, and it
--                      compute.ts              LEFT joins, so a missing vector
--                                              degrades to headline overlap
--   Global search      src/lib/search.ts       ONLY articles NOT saved to the
--                                              Directory
--   Related sidebar    /api/related            any article
--
-- So an embedding on an old, unsaved, never-touched feed article is bought
-- entirely for global semantic search and the related sidebar. Nothing else
-- would miss it. Query 2 counts how many of yours are in that category.
-- ─────────────────────────────────────────────────────────────────────

-- 1. What the embeddings cost right now, split into vector vs index.
select
  (select count(*) from article_embeddings)                          as rows,
  pg_size_pretty(pg_total_relation_size('article_embeddings'))       as total,
  pg_size_pretty(pg_relation_size('article_embeddings_embedding_idx')) as ann_index,
  pg_size_pretty(
    pg_total_relation_size('article_embeddings')
    - pg_relation_size('article_embeddings_embedding_idx'))          as vector_and_rows,
  (pg_total_relation_size('article_embeddings')
    / nullif((select count(*) from article_embeddings), 0))::int     as bytes_per_row;

-- 2. Who needs each embedding. `expendable` is what you could drop without any
--    consumer above losing a row it reads — global search and the related
--    sidebar would stop surfacing those articles semantically; keyword search
--    still finds them.
with classified as (
  select
    e.article_id,
    exists (select 1 from directory_items di where di.article_id = a.id) as saved,
    (a.starred or a.read_later)                                          as kept,
    (a.read_status <> 'unread')                                          as engaged,
    (a.publish_date > now() - interval '48 hours')                       as fresh
  from article_embeddings e
  join articles a on a.id = e.article_id
)
select
  count(*)                                                          as embeddings,
  count(*) filter (where saved)                                     as needed_by_ask,
  count(*) filter (where fresh)                                     as needed_by_trending,
  count(*) filter (where kept or engaged)                           as you_engaged_with,
  count(*) filter (where not saved and not kept and not engaged and not fresh)
                                                                    as expendable,
  round(100.0 * count(*) filter (where not saved and not kept and not engaged and not fresh)
        / nullif(count(*), 0), 1)                                   as expendable_pct,
  pg_size_pretty(
    (count(*) filter (where not saved and not kept and not engaged and not fresh)
     * (pg_total_relation_size('article_embeddings')
        / nullif((select count(*) from article_embeddings), 0)))::bigint)
                                                                    as expendable_size
from classified;

-- 3. The same, by age, so you can pick a cut-off rather than a rule.
--    (Only counts rows nothing else needs — saved, starred, read-later, read
--    and last-48h articles are excluded at every age.)
with classified as (
  select
    a.created_at,
    exists (select 1 from directory_items di where di.article_id = a.id) as saved,
    (a.starred or a.read_later)                                          as kept,
    (a.read_status <> 'unread')                                          as engaged,
    (a.publish_date > now() - interval '48 hours')                       as fresh
  from article_embeddings e
  join articles a on a.id = e.article_id
)
select
  bucket,
  count(*) as expendable_embeddings,
  pg_size_pretty((count(*) * (pg_total_relation_size('article_embeddings')
    / nullif((select count(*) from article_embeddings), 0)))::bigint) as approx_size
from (
  select case
    when created_at > now() - interval '30 days'  then '1: under 30 days'
    when created_at > now() - interval '90 days'  then '2: 30-90 days'
    when created_at > now() - interval '180 days' then '3: 90-180 days'
    else                                               '4: over 180 days'
  end as bucket
  from classified
  where not saved and not kept and not engaged and not fresh
) b
group by bucket
order by bucket;

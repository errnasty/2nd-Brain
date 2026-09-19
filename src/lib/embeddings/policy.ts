import { sql, type SQL } from "drizzle-orm";
import { RETENTION_DAYS } from "@/lib/feeds/retention";

/**
 * Which articles deserve a stored vector.
 *
 * An article embedding is 1024 fp16 values — a few KB once the row and its
 * TOAST are counted — and a feed reader accumulates articles forever. Unread
 * ones are never purged (see lib/feeds/retention.ts), so without this every
 * headline the app has ever seen keeps a vector for good.
 *
 * ## What a vector on an old, untouched article is actually for
 *
 * Only four things read `article_embeddings`, and they want different rows:
 *
 *   Ask / RAG        src/lib/ai/rag.ts        inner-joins directory_items, so
 *                                             ONLY articles saved to the
 *                                             Directory
 *   Trending         src/lib/trending/        the last 48 hours only, and it
 *                    compute.ts               LEFT joins — a missing vector
 *                                             degrades to headline overlap
 *   Global search    src/lib/search.ts        only articles NOT saved
 *   Related sidebar  /api/related             any article
 *
 * So a vector on an article that is old, unsaved and never opened is bought
 * entirely for global semantic search and the related sidebar. Everything else
 * either cannot see it or does not care. That is the trade this policy makes:
 * those two stop reaching into the long tail, and keyword search — which is
 * trigram/tsvector indexed and untouched — still finds it.
 *
 * ## Why this has to be one predicate
 *
 * `backfillEmbeddings` creates vectors and `expireStaleArticleEmbeddings`
 * removes them. If the two disagree by even one row, that row is embedded,
 * expired, re-embedded, expired… forever, burning a paid provider call every
 * cycle. They are complements of ONE expression for that reason: the backfill
 * embeds where this holds, the expiry deletes where it does not, and
 * `policy.test.ts` asserts the two cover every article exactly once.
 *
 * Keeping the window equal to RETENTION_DAYS makes the whole story one
 * sentence: a rolling month of everything, plus anything you touched, forever.
 *
 * @param alias the `articles` alias in the surrounding query. A constant at
 *              every call site; never user input.
 */
export function deservesEmbeddingSql(alias = "a"): SQL {
  return sql.raw(`(
    ${alias}.starred
    or ${alias}.read_later
    or ${alias}.read_status <> 'unread'
    or ${alias}.created_at > now() - interval '${RETENTION_DAYS} days'
    or exists (
      select 1 from directory_items di
      where di.article_id = ${alias}.id and di.user_id = ${alias}.user_id
    )
  )`);
}

/**
 * The same rule in prose, for the one place a human reads it.
 *
 * Kept next to the predicate so the two cannot drift; the settings copy and the
 * changelog both describe this behaviour and should match it.
 */
export const EMBEDDING_POLICY_SUMMARY =
  `Articles keep their semantic-search vector for ${RETENTION_DAYS} days, ` +
  "and keep it permanently once starred, saved for later, opened, or added to the Directory.";

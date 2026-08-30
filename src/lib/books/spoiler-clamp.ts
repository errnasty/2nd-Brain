import { sql, type SQL } from "drizzle-orm";

/**
 * The spoiler clamp.
 *
 * With the per-book toggle on, the assistant may only see chapters up to the
 * furthest point the reader has actually reached. Without it, a question as
 * ordinary as "who is this character?" can answer with what happens to them in
 * chapter 30.
 *
 * Written as one expression rather than a join so it can be dropped into any
 * query that already reaches `document_chunks`:
 *
 *   • `chapter_index is null` — not a book. Every PDF, note and article chunk
 *     passes untouched, which is why this is safe to add everywhere.
 *   • no reading-state row, or the toggle is off — the subquery yields null,
 *     `coalesce` falls back to the row's own chapter index, and the comparison
 *     is trivially true.
 *   • toggle on — compared against `furthest_chapter_idx`, which only ever
 *     increases, so re-reading an early chapter never re-hides a later one.
 *
 * @param alias table alias `document_chunks` carries in the surrounding query.
 *              A constant at every call site; never user input.
 */
export function spoilerClampSql(alias = "c"): SQL {
  return sql.raw(`(
    ${alias}.chapter_index is null
    or ${alias}.chapter_index <= coalesce(
      (select case when s.spoiler_safe then s.furthest_chapter_idx end
         from book_reading_state s
        where s.document_id = ${alias}.document_id
          and s.user_id = ${alias}.user_id),
      ${alias}.chapter_index
    )
  )`);
}

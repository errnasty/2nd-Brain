// Desktop ⇄ cloud sync engine (Phase 4).
//
// Local PGlite is the working database; Supabase Postgres is the cloud. Each
// run pulls cloud changes since the per-table cursor, applies them locally with
// last-write-wins (newest updated_at wins), then pushes local changes the same
// way. Deletes propagate via sync_tombstones rows written by AFTER DELETE
// triggers on both sides (migration 0013 / local bootstrap).
//
// Not echoing applied changes back:
//   - LOCAL apply runs under `session_replication_role = replica`, which
//     disables the touch/tombstone triggers (PGlite traps on the GUC path).
//   - CLOUD apply sets the GUC app.sync_apply='1', which the triggers check
//     (Supabase doesn't allow setting session_replication_role).
//
// Pagination is keyset on (updated_at, id) so rows sharing a bulk-insert
// timestamp are never skipped (the old `updated_at >` cursor silently dropped
// them). Composite-PK tables (item_tags) use a plain updated_at cursor.
//
// Derived tables (directory_tasks, directory_links) are NOT synced; they are
// re-derived from note content after a pull (and on the cloud after a push).
// Embedding columns are never synced (large; regenerated locally).
import postgres from "postgres";
import { getPgliteClient } from "@/lib/db";
import { parseTasks } from "@/lib/tasks/parse";

const isDesktop = process.env.APP_RUNTIME === "desktop";
const BATCH = 500;
const EPOCH = "1970-01-01 00:00:00+00";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
// Cursor key: exact integer (epoch microseconds). timestamptz::text round-trips
// LOSSILY (parsed value < stored), which made `updated_at > cursor` always true
// and re-fetched the whole table forever. A bigint round-trips exactly.
const UT = "(extract(epoch from t.updated_at)*1000000)::bigint";
const TOMBSTONE_KEEP_DAYS = 30;

type TableCfg = {
  name: string;
  pk: string[];
  userCol: string | null; // null = profiles (id IS the user id)
  exclude: string[];
};

// FK-safe order: parents before children.
const TABLES: TableCfg[] = [
  { name: "profiles", pk: ["id"], userCol: null, exclude: [] },
  { name: "folders", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "feeds", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "tags", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "articles", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "documents", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "document_chunks", pk: ["id"], userCol: "user_id", exclude: ["embedding"] },
  { name: "directory_folders", pk: ["id"], userCol: "user_id", exclude: [] },
  { name: "directory_items", pk: ["id"], userCol: "user_id", exclude: ["embedding"] },
  { name: "item_tags", pk: ["tag_id", "item_kind", "item_id"], userCol: "user_id", exclude: [] },
  { name: "directory_flashcards", pk: ["id"], userCol: "user_id", exclude: [] },
];
const DELETABLE = new Set(TABLES.filter((t) => t.pk.length === 1 && t.pk[0] === "id").map((t) => t.name));
const isIdPk = (t: TableCfg) => t.pk.length === 1 && t.pk[0] === "id";

export type SyncSummary = {
  ok: boolean;
  startedAt: string;
  finishedAt?: string;
  pulled: number;
  pushed: number;
  deletesApplied: number;
  deletesPushed: number;
  skipped: number;
  conflicts: number;
  error?: string;
};

const state: { running: boolean; last: SyncSummary | null } = { running: false, last: null };
export function syncStatus() {
  return { running: state.running, last: state.last };
}

// ── connections ─────────────────────────────────────────────────────────

type Cloud = ReturnType<typeof postgres>;
let cloud: Cloud | null = null;
function getCloud(): Cloud | null {
  if (!process.env.DATABASE_URL) return null;
  if (!cloud) {
    cloud = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
  }
  return cloud;
}
function isConnErr(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /ECONNRESET|CONNECTION|connection|closed|terminat|ETIMEDOUT|EPIPE|socket/i.test(m);
}
/** Run a cloud op, reconnecting + retrying on a dropped pooler connection. */
async function cloudRetry<T>(fn: (c: Cloud) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = getCloud()!;
    try {
      return await fn(c);
    } catch (e) {
      if (attempt < 3 && isConnErr(e)) {
        try {
          await c.end({ timeout: 1 });
        } catch {
          /* ignore */
        }
        cloud = null;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

type Pg = NonNullable<ReturnType<typeof getPgliteClient>> & {
  transaction<T>(cb: (tx: { query(q: string, p?: unknown[]): Promise<unknown> }) => Promise<T>): Promise<T>;
};

const qi = (c: string) => `"${c}"`;

async function metaGet(pg: Pg, key: string): Promise<string | null> {
  const r = (await pg.query("select value from sync_meta where key = $1", [key])) as { rows: { value: string }[] };
  return r.rows[0]?.value ?? null;
}
async function metaSet(pg: Pg, key: string, value: string): Promise<void> {
  await pg.query(
    "insert into sync_meta (key,value) values ($1,$2) on conflict (key) do update set value = excluded.value",
    [key, value],
  );
}

type Col = { name: string; udt: string };

async function sharedColumns(pg: Pg): Promise<Map<string, Col[]>> {
  // Skip generated/identity columns — they can't be written and may exist on
  // only one side (e.g. a full-text tsvector column on the cloud).
  const q =
    "select table_name, column_name, udt_name, is_generated, is_identity from information_schema.columns where table_schema='public'";
  const localRows = (await pg.query(q)) as { rows: { table_name: string; column_name: string }[] };
  const cloudRows = (await cloudRetry((c) => c.unsafe(q))) as unknown as {
    table_name: string;
    column_name: string;
    udt_name: string;
    is_generated: string;
    is_identity: string;
  }[];
  const local = new Map<string, Set<string>>();
  for (const r of localRows.rows) {
    (local.get(r.table_name) ?? local.set(r.table_name, new Set()).get(r.table_name)!).add(r.column_name);
  }
  const out = new Map<string, Col[]>();
  for (const t of TABLES) {
    const l = local.get(t.name) ?? new Set();
    const cols = cloudRows
      .filter(
        (r) =>
          r.table_name === t.name &&
          l.has(r.column_name) &&
          !t.exclude.includes(r.column_name) &&
          r.is_generated !== "ALWAYS" &&
          r.is_identity !== "YES",
      )
      .map((r) => ({ name: r.column_name, udt: r.udt_name }));
    if (!cols.some((c) => c.name === "updated_at")) {
      throw new Error(`Table ${t.name} missing updated_at — run migration 0013 on the cloud DB.`);
    }
    out.set(t.name, cols);
  }
  return out;
}

// Extract one column from the $1 jsonb payload with the right type. Avoids
// jsonb_populate_record(null::table, …), which constructs the full row type
// (including pgvector `vector` columns) and errors with "cannot call
// populate_composite on a scalar".
function colExpr(c: Col): string {
  if (c.udt === "jsonb" || c.udt === "json") return `(($1::jsonb)->${`'${c.name}'`})`;
  return `($1::jsonb->>'${c.name}')::"${c.udt}"`;
}

function upsertSql(t: TableCfg, cols: Col[], lww: boolean): string {
  const colList = cols.map((c) => qi(c.name)).join(",");
  const selectList = cols.map(colExpr).join(",");
  const updates = cols
    .filter((c) => !t.pk.includes(c.name))
    .map((c) => `${qi(c.name)}=excluded.${qi(c.name)}`)
    .join(",");
  const guard = lww ? ` where t.updated_at < excluded.updated_at` : "";
  return (
    `insert into ${t.name} as t (${colList}) select ${selectList} ` +
    `on conflict (${t.pk.map(qi).join(",")}) do update set ${updates}${guard}`
  );
}

// ── main ──────────────────────────────────────────────────────────────────

export async function runSync(): Promise<SyncSummary> {
  const s: SyncSummary = {
    ok: false,
    startedAt: new Date().toISOString(),
    pulled: 0,
    pushed: 0,
    deletesApplied: 0,
    deletesPushed: 0,
    skipped: 0,
    conflicts: 0,
  };
  if (!isDesktop) return { ...s, error: "sync only runs on the desktop build" };
  if (state.running) return { ...s, error: "sync already running" };

  const pg = getPgliteClient() as Pg | null;
  const sql = getCloud();
  if (!pg) return { ...s, error: "local database unavailable" };
  if (!sql) return { ...s, error: "DATABASE_URL not configured (Settings → cloud sync)" };

  state.running = true;
  try {
    let userId = ((await pg.query("select id from profiles limit 1")) as { rows: { id: string }[] }).rows[0]?.id;
    if (!userId) {
      const cp = (await cloudRetry((c) => c`select id from profiles`)) as unknown as { id: string }[];
      if (cp.length === 1) {
        userId = cp[0].id;
        await pg.query("insert into profiles (id) values ($1) on conflict do nothing", [userId]);
      }
    }
    if (!userId) return { ...s, error: "no profile (sign in once, or set cloud creds)" };

    const cols = await sharedColumns(pg);
    const initial = (await metaGet(pg, "initialized")) !== "1";
    const cloudNow = ((await cloudRetry((c) => c`select now()::text as n`)) as unknown as { n: string }[])[0].n;

    const pulledKeys = new Set<string>();
    const pulledItems: { id: string; content: string | null }[] = [];

    // Apply one cloud row into local (triggers disabled via replica role).
    const localDb = pg;
    async function applyLocal(stmt: string, rowJson: string) {
      await localDb.transaction(async (tx) => {
        await tx.query("set local session_replication_role = replica");
        await tx.query(stmt, [rowJson]);
      });
    }
    // Apply a whole batch in ONE transaction — ~BATCH× fewer round-trips than a
    // transaction per row (the first full sync is tens of thousands of rows).
    // The caller falls back to per-row applyLocal if the batch throws, so one
    // bad row never drops the other 499.
    async function applyLocalBatch(stmt: string, rowJsons: string[]) {
      await localDb.transaction(async (tx) => {
        await tx.query("set local session_replication_role = replica");
        for (const rj of rowJsons) await tx.query(stmt, [rj]);
      });
    }

    // Watermark for "edited locally since the last sync" — the previous run's
    // directory_items push cursor. Used to detect multi-device edit conflicts.
    const itemsPushRaw = await metaGet(pg, "push:directory_items");
    const itemsSyncedMicros = itemsPushRaw ? String((JSON.parse(itemsPushRaw) as [string, string])[0]) : "-1";

    // ── PULL (cloud → local), keyset (updated_at,id) per table ───────
    for (const t of TABLES) {
      const tCols = cols.get(t.name)!;
      const excl = t.exclude.map((c) => ` - '${c}'`).join("");
      const userPred = t.userCol ? `t.${t.userCol} = $1` : `t.id = $1`;
      const stmt = upsertSql(t, tCols, !initial);
      const useId = isIdPk(t);
      const curRaw = await metaGet(pg, `pull:${t.name}`);
      let cur: [string, string] = curRaw ? JSON.parse(curRaw) : ["-1", ZERO_UUID];

      for (;;) {
        const where = useId
          ? `${userPred} and (${UT}, t.id) > ($2::bigint, $3::uuid)`
          : `${userPred} and ${UT} > $2::bigint`;
        const order = useId ? `order by ${UT} asc, t.id asc` : `order by ${UT} asc`;
        const params = useId ? [userId, cur[0], cur[1]] : [userId, cur[0]];
        const selectSql =
          `select to_jsonb(t)${excl} as row, ${UT}::text as u${useId ? ", t.id::text as kid" : ""} ` +
          `from ${t.name} t where ${where} ${order} limit ${BATCH}`;
        const rows = (await cloudRetry((c) => c.unsafe(selectSql, params))) as unknown as {
          row: Record<string, unknown>;
          u: string;
          kid?: string;
        }[];
        if (rows.length === 0) break;

        // PGlite returns jsonb as a string; postgres-js as an object. Normalize.
        const prepared = rows.map((r) => ({
          row: (typeof r.row === "string" ? JSON.parse(r.row) : r.row) as Record<string, unknown>,
          u: r.u,
        }));
        const note = (p: (typeof prepared)[number]) => {
          s.pulled += 1;
          pulledKeys.add(`${t.name}|${t.pk.map((c) => String(p.row[c])).join("|")}|${p.u}`);
          if (t.name === "directory_items") {
            pulledItems.push({ id: String(p.row.id), content: (p.row.content as string | null) ?? null });
          }
        };

        // Conflict detection (notes only): a row about to be overwritten that
        // was ALSO edited locally since the last sync (local older → it loses).
        // One set-based query per batch keeps the hot path fast.
        if (t.name === "directory_items" && !initial) {
          const remoteMicros = new Map(prepared.map((p) => [String(p.row.id), p.u]));
          const ids = JSON.stringify([...remoteMicros.keys()]);
          const dirty = (await pg.query(
            `select id::text as id, title, content,
                    (extract(epoch from updated_at)*1000000)::bigint::text as lu
             from directory_items
             where id in (select value::uuid from jsonb_array_elements_text($1::jsonb) as value)
               and (extract(epoch from updated_at)*1000000)::bigint > $2::bigint`,
            [ids, itemsSyncedMicros],
          )) as { rows: { id: string; title: string | null; content: string | null; lu: string }[] };
          for (const d of dirty.rows) {
            const rm = remoteMicros.get(d.id);
            if (rm && BigInt(rm) > BigInt(d.lu)) {
              try {
                await pg.query(
                  `insert into sync_conflicts
                     (row_id, table_name, title, local_content, local_updated_at, remote_updated_at)
                   values ($1,'directory_items',$2,$3,
                           to_timestamp($4::bigint/1000000.0), to_timestamp($5::bigint/1000000.0))
                   on conflict (row_id) do update set
                     title=excluded.title, local_content=excluded.local_content,
                     local_updated_at=excluded.local_updated_at,
                     remote_updated_at=excluded.remote_updated_at,
                     detected_at=now(), resolved=false`,
                  [d.id, d.title, d.content, d.lu, rm],
                );
                s.conflicts += 1;
              } catch (err) {
                console.warn("[sync] conflict record skip:", err instanceof Error ? err.message : err);
              }
            }
          }
        }
        try {
          await applyLocalBatch(stmt, prepared.map((p) => JSON.stringify(p.row)));
          for (const p of prepared) note(p);
        } catch {
          // One row poisoned the batch — replay row-by-row so the rest land.
          for (const p of prepared) {
            try {
              await applyLocal(stmt, JSON.stringify(p.row));
              note(p);
            } catch (err) {
              s.skipped += 1;
              console.warn(`[sync] pull skip ${t.name}:`, err instanceof Error ? err.message : err);
            }
          }
        }
        const last = rows[rows.length - 1];
        cur = [last.u, useId ? last.kid! : ZERO_UUID];
        await metaSet(pg, `pull:${t.name}`, JSON.stringify(cur));
        if (rows.length < BATCH) break;
      }
    }

    // ── PULL tombstones (cloud deletes → local) ─────────────────────
    if (initial) {
      await metaSet(pg, "pull:tombstones", cloudNow);
    } else {
      let cursor = (await metaGet(pg, "pull:tombstones")) ?? EPOCH;
      for (;;) {
        const tq =
          `select table_name, row_id, deleted_at::text as d from sync_tombstones ` +
          `where user_id = $1 and deleted_at > $2::timestamptz order by deleted_at asc limit ${BATCH}`;
        const rows = (await cloudRetry((c) => c.unsafe(tq, [userId, cursor]))) as unknown as {
          table_name: string;
          row_id: string;
          d: string;
        }[];
        if (rows.length === 0) break;
        for (const r of rows) {
          if (!DELETABLE.has(r.table_name)) continue;
          try {
            await pg.transaction(async (tx) => {
              await tx.query("set local session_replication_role = replica");
              await tx.query(`delete from ${r.table_name} where id = $1`, [r.row_id]);
            });
            s.deletesApplied += 1;
          } catch (err) {
            s.skipped += 1;
            console.warn(`[sync] delete skip ${r.table_name}:`, err instanceof Error ? err.message : err);
          }
        }
        cursor = rows[rows.length - 1].d;
        await metaSet(pg, "pull:tombstones", cursor);
        if (rows.length < BATCH) break;
      }
    }

    // ── PUSH (local → cloud) ────────────────────────────────────────
    const pushedItems: { id: string; content: string | null }[] = [];
    // postgres-js serializes a JS object param to jsonb correctly; passing a
    // STRING makes it a jsonb string scalar (→ ->>'id' is null). PGlite is the
    // opposite (wants a string), so applyLocal stringifies and this doesn't.
    async function applyCloud(stmt: string, rowObj: Record<string, unknown>) {
      await cloudRetry((c) =>
        c.begin(async (tx) => {
          await tx`select set_config('app.sync_apply','1',true)`;
          // postgres-js serializes the object param to jsonb. Cast: its param
          // type is inferred as `never` here.
          await tx.unsafe(stmt, [rowObj as never]);
        }),
      );
    }

    for (const t of TABLES) {
      const tCols = cols.get(t.name)!;
      const excl = t.exclude.map((c) => ` - '${c}'`).join("");
      const userPred = t.userCol ? `t.${t.userCol} = $1` : `t.id = $1`;
      const stmt = upsertSql(t, tCols, true);
      const useId = isIdPk(t);
      const curRaw = await metaGet(pg, `push:${t.name}`);
      let cur: [string, string] = curRaw ? JSON.parse(curRaw) : ["-1", ZERO_UUID];

      for (;;) {
        const where = useId
          ? `${userPred} and (${UT}, t.id) > ($2::bigint, $3::uuid)`
          : `${userPred} and ${UT} > $2::bigint`;
        const order = useId ? `order by ${UT} asc, t.id asc` : `order by ${UT} asc`;
        const params = useId ? [userId, cur[0], cur[1]] : [userId, cur[0]];
        const res = (await pg.query(
          `select to_jsonb(t)${excl} as row, ${UT}::text as u${useId ? ", t.id::text as kid" : ""} ` +
            `from ${t.name} t where ${where} ${order} limit ${BATCH}`,
          params,
        )) as { rows: { row: Record<string, unknown>; u: string; kid?: string }[] };
        const rows = res.rows;
        if (rows.length === 0) break;

        for (const r of rows) {
          const row = typeof r.row === "string" ? (JSON.parse(r.row) as Record<string, unknown>) : r.row;
          const key = `${t.name}|${t.pk.map((c) => String(row[c])).join("|")}|${r.u}`;
          if (pulledKeys.has(key)) continue; // just pulled — don't echo back
          try {
            await applyCloud(stmt, row);
            s.pushed += 1;
            if (t.name === "directory_items") {
              pushedItems.push({ id: String(row.id), content: (row.content as string | null) ?? null });
            }
          } catch (err) {
            s.skipped += 1;
            console.warn(`[sync] push skip ${t.name}:`, err instanceof Error ? err.message : err);
          }
        }
        const last = rows[rows.length - 1];
        cur = [last.u, useId ? last.kid! : ZERO_UUID];
        await metaSet(pg, `push:${t.name}`, JSON.stringify(cur));
        if (rows.length < BATCH) break;
      }
    }

    // ── PUSH tombstones (local deletes → cloud) ─────────────────────
    {
      let cursor = (await metaGet(pg, "push:tombstones")) ?? (initial ? new Date().toISOString() : EPOCH);
      for (;;) {
        const res = (await pg.query(
          `select table_name, row_id, deleted_at::text as d from sync_tombstones ` +
            `where user_id = $1 and deleted_at > $2::timestamptz order by deleted_at asc limit ${BATCH}`,
          [userId, cursor],
        )) as { rows: { table_name: string; row_id: string; d: string }[] };
        const rows = res.rows;
        if (rows.length === 0) break;
        for (const r of rows) {
          if (!DELETABLE.has(r.table_name)) continue;
          try {
            await cloudRetry((c) =>
              c.begin(async (tx) => {
                await tx`select set_config('app.sync_apply','1',true)`;
                await tx.unsafe(`delete from ${r.table_name} where id = $1`, [r.row_id]);
              }),
            );
            s.deletesPushed += 1;
          } catch (err) {
            s.skipped += 1;
            console.warn(`[sync] tombstone push skip:`, err instanceof Error ? err.message : err);
          }
        }
        cursor = rows[rows.length - 1].d;
        await metaSet(pg, "push:tombstones", cursor);
        if (rows.length < BATCH) break;
      }
    }

    // ── Re-derive task/link tables from synced note content ─────────
    if (pulledItems.length > 0) {
      const { syncDirectoryTasks } = await import("@/lib/tasks/sync");
      const { syncWikilinks } = await import("@/lib/directory/wikilinks");
      for (const it of pulledItems) {
        try {
          await syncDirectoryTasks(userId, it.id, it.content);
          await syncWikilinks(userId, it.id, it.content);
        } catch (err) {
          console.warn("[sync] rederive skip:", err instanceof Error ? err.message : err);
        }
      }
    }
    for (const it of pushedItems) {
      try {
        const tasks = parseTasks(it.content);
        await cloudRetry((c) =>
          c.begin(async (tx) => {
            await tx`select set_config('app.sync_apply','1',true)`;
            await tx`delete from directory_tasks where user_id = ${userId} and item_id = ${it.id}`;
            for (const task of tasks) {
              await tx`insert into directory_tasks (user_id, item_id, text, done, due_date, line_index, raw_line)
                values (${userId}, ${it.id}, ${task.text}, ${task.done},
                        ${task.dueDate ? `${task.dueDate}T00:00:00Z` : null}, ${task.lineIndex}, ${task.rawLine})`;
            }
          }),
        );
      } catch (err) {
        console.warn("[sync] cloud task rederive skip:", err instanceof Error ? err.message : err);
      }
    }

    // ── Housekeeping ────────────────────────────────────────────────
    await cloudRetry((c) =>
      c.unsafe(
        `delete from sync_tombstones where user_id = $1 and deleted_at < now() - interval '${TOMBSTONE_KEEP_DAYS} days'`,
        [userId],
      ),
    );
    await pg.query(`delete from sync_tombstones where deleted_at < now() - interval '${TOMBSTONE_KEEP_DAYS} days'`);
    await metaSet(pg, "initialized", "1");
    await metaSet(pg, "lastSyncAt", new Date().toISOString());

    if (s.pulled > 0) {
      import("@/lib/embeddings/backfill")
        .then(({ backfillEmbeddings }) => backfillEmbeddings(userId, 200))
        .catch((err) => console.warn("[sync] embed backfill skip:", err instanceof Error ? err.message : err));
    }

    s.ok = true;
    s.finishedAt = new Date().toISOString();
    return s;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
    s.finishedAt = new Date().toISOString();
    return s;
  } finally {
    state.last = s;
    state.running = false;
  }
}

/** Periodic background sync (desktop server process only). */
export function startSyncLoop(intervalMs = 5 * 60_000): void {
  if (!isDesktop || !process.env.DATABASE_URL) return;
  const g = globalThis as unknown as { __sbSyncLoop?: boolean };
  if (g.__sbSyncLoop) return;
  g.__sbSyncLoop = true;
  setTimeout(() => void runSync(), 8_000);
  setInterval(() => void runSync(), intervalMs);
  console.log("[sync] background loop started");
}

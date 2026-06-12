import { drizzle as pgDrizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type SQL } from "drizzle-orm";
import * as schema from "./schema";

type Schema = typeof schema;

// Desktop (Electron) runs an embedded local Postgres (PGlite) for instant,
// offline reads/writes; the cloud (Netlify) keeps the Supabase postgres-js
// connection. Same Drizzle schema + query builder either way. PGlite is loaded
// lazily so the cloud bundle never instantiates the WASM engine.
const isDesktop = process.env.APP_RUNTIME === "desktop";

// Kept so the schema bootstrap + sync engine can talk to the raw PGlite client.
type PgliteClient = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  waitReady?: Promise<void>;
};
let pgliteClient: PgliteClient | null = null;

function build(): PostgresJsDatabase<Schema> {
  if (isDesktop) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { vector } = require("@electric-sql/pglite/vector");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle: pgliteDrizzle } = require("drizzle-orm/pglite");
    const dir = process.env.LOCAL_DB_DIR || "./.pglite-data";
    // Cache the PGlite instance on globalThis: Next dev/HMR re-evaluates this
    // module, and a second PGlite on the same data dir corrupts/locks it.
    const g = globalThis as unknown as { __sbPglite?: unknown };
    const client = (g.__sbPglite ??= new PGlite(dir, { extensions: { vector } }));
    pgliteClient = client as PgliteClient;

    const instance = pgliteDrizzle(client, { schema });
    // Normalize raw `db.execute(sql\`…\`)`: PGlite returns `{ rows, … }` whereas
    // postgres-js returns an array-like RowList. We make PGlite return the rows
    // ARRAY too, so every existing `(await db.execute(...)) as Row[]` call site
    // works unchanged on both drivers. The query builder (.select/.insert/…)
    // does NOT go through this method, so it is unaffected.
    const realExecute = instance.execute.bind(instance) as (q: SQL) => Promise<unknown>;
    (instance as unknown as { execute: (q: SQL) => Promise<unknown> }).execute = async (q: SQL) => {
      const r = (await realExecute(q)) as { rows?: unknown };
      return r && Array.isArray(r.rows) ? r.rows : r;
    };

    return instance as unknown as PostgresJsDatabase<Schema>;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // prepare: false is required by Supabase's transaction-mode pooler (6543).
  // max: 3 keeps parallel queries fast without exhausting Supabase's limit.
  const client = postgres(connectionString, { prepare: false, max: 3, idle_timeout: 20 });
  return pgDrizzle(client, { schema });
}

export const db = build();
export { schema };

export const dbKind: "pglite" | "postgres-js" = isDesktop ? "pglite" : "postgres-js";

/** Raw PGlite client (desktop only) — for schema bootstrap + the sync engine. */
export function getPgliteClient(): PgliteClient | null {
  return pgliteClient;
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// prepare: false is required by Supabase's transaction-mode pooler (port 6543).
// max: 3 — each serverless instance opens its own pool, so this multiplies
// across concurrent instances. 3 keeps parallel queries-per-request fast
// without exhausting Supabase's connection limit under load.
const client = postgres(connectionString, {
  prepare: false,
  max: 3,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
export { schema };

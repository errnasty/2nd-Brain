import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// prepare: false is required by Supabase's transaction-mode pooler (port 6543).
// max: 5 lets parallel queries within one request actually run in parallel
// rather than serializing on a single TCP connection.
const client = postgres(connectionString, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
export { schema };

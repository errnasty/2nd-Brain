import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type RateLimitResult = { allowed: boolean; count: number; limit: number };

/**
 * Atomic fixed-window rate limit, keyed by (userId, bucket).
 *
 * A single upsert increments the counter; if the window has expired it resets
 * to 1. Returns allowed=false once the count exceeds `limit` within the window.
 * Fails OPEN (allows the request) if the rate_limits table is missing or the
 * query errors — availability over strictness for a personal app.
 */
export async function checkRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const rows = (await db.execute(sql`
      insert into rate_limits (user_id, bucket, count, window_start)
      values (${userId}, ${bucket}, 1, now())
      on conflict (user_id, bucket) do update set
        count = case
          when rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
            then now()
          else rate_limits.window_start
        end
      returning count
    `)) as unknown as Array<{ count: number }>;

    const count = rows[0]?.count ?? 1;
    return { allowed: count <= limit, count, limit };
  } catch {
    return { allowed: true, count: 0, limit };
  }
}

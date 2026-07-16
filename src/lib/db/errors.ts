/**
 * A failed db.* call throws Drizzle's DrizzleQueryError, whose OWN .message is
 * just "Failed query: <sql>\nparams: <values>" — a dump of the statement and
 * every row's raw content, not the actual reason. The real driver/Postgres
 * error (e.g. "column \"stability\" of relation ... does not exist") lives on
 * .cause. Prefer that; fall back to .message for any other error shape.
 */
export function dbErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message || fallback;
  }
  return fallback;
}

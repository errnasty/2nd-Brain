/**
 * True when a request's response was cut off mid-flight — a serverless
 * timeout severing a long AI call, or a dropped connection — while the server
 * almost certainly kept working and will finish the job. Callers should show
 * a "still working" message instead of a false failure.
 *
 * Matches both the Next server-action failure ("An unexpected response was
 * received from the server") and the browser fetch network errors ("Failed to
 * fetch" / "NetworkError…" / "Load failed"). An explicit abort is NOT severed —
 * the user cancelled on purpose.
 */
export function isSeveredResponse(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  return /unexpected response|failed to fetch|networkerror|load failed|network request failed/i.test(
    err.message,
  );
}

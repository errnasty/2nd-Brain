/**
 * Where the reader goes when a book is closed.
 *
 * The book is opened with a `?from=` carrying the page it was opened from, so
 * closing it returns to that folder (and, on a phone, to the book's own entry
 * in it) rather than dumping everyone at the Directory root.
 *
 * That value arrives in the URL, which means anyone can put anything in it and
 * the reader will `router.push()` the result. So it is validated rather than
 * trusted, and the rule is narrow on purpose: exactly one leading slash. That
 * accepts in-app paths and rejects everything that leaves the app, including
 * the case worth naming — `//evil.example`, a protocol-relative URL that most
 * eyes read as a path and every browser reads as another origin.
 */

/** The Directory root: where a book with no origin, or a bad one, goes back to. */
export const DEFAULT_RETURN_PATH = "/directory";

/** A `?from=` value that is safe to navigate to, or null. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith("/")) return null;
  // `//host` and `/\host` are both read as protocol-relative by browsers.
  if (path.startsWith("//") || path.startsWith("/\\")) return null;
  // A control character can smuggle a newline past something that parses this
  // later. Nothing legitimate here contains one.
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

/**
 * Path arithmetic inside an ePub zip.
 *
 * Every href in a book is relative to the file that contains it, and the OPF
 * frequently lives in a subdirectory (`OEBPS/content.opf`), so almost nothing
 * can be looked up in the zip without being resolved first. Hrefs are also
 * URL-encoded while zip entry names are not, which is why `Chapter%201.xhtml`
 * finds nothing until it is decoded.
 */

/** The directory part of a zip entry path, with its trailing slash. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** Split `text/ch1.xhtml#note-3` into its path and fragment. */
export function splitFragment(href: string): { path: string; fragment: string | null } {
  const i = href.indexOf("#");
  if (i === -1) return { path: href, fragment: null };
  return { path: href.slice(0, i), fragment: href.slice(i + 1) || null };
}

/** True for hrefs that point outside the book and must be left alone. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/**
 * Collapse `.` and `..` segments.
 *
 * Returns null when the path climbs above the zip root. A book that asks for
 * `../../../etc/passwd` is either broken or hostile, and either way there is
 * nothing above the root to serve.
 */
export function normalizeZipPath(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join("/");
}

/**
 * Resolve an href found inside `baseFile` to a zip entry path.
 *
 * Returns null for external links, for anything that escapes the zip root, and
 * for a bare fragment (`#note-3`), which addresses the current file rather than
 * another entry.
 */
export function resolveHref(baseFile: string, href: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || isExternalHref(raw)) return null;

  const { path } = splitFragment(raw);
  if (!path) return null;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding: fall back to the literal text, which is what
    // the zip entry is most likely named anyway.
  }

  // A leading slash in an ePub means the zip root, not the filesystem root.
  const joined = decoded.startsWith("/") ? decoded.slice(1) : dirOf(baseFile) + decoded;
  return normalizeZipPath(joined);
}

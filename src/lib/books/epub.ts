import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { dirOf, normalizeZipPath, resolveHref, splitFragment } from "./paths";

/**
 * Full ePub reader-side parse.
 *
 * `lib/documents/parsers/epub.ts` already walks a book to extract text; this
 * walks it to *render* one. It keeps the spine as addressable entries, resolves
 * chapter titles from whichever table of contents the book actually shipped,
 * finds the cover, and reports the two conditions that make a book unreadable
 * before anything else is attempted.
 *
 * Nothing here holds more than one entry's bytes at a time. A 50MB book is
 * walked, not loaded.
 */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  // Titles like "1984" must stay strings — a numeric coercion turns a chapter
  // called "1984" into the number 1984 and a title of "007" into 7.
  parseTagValue: false,
});

export type EpubErrorCode = "drm" | "invalid";

export class EpubError extends Error {
  constructor(
    readonly code: EpubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EpubError";
  }
}

export type EpubSpineEntry = {
  /** Spine position — reading order, and the only id the reader ever uses. */
  idx: number;
  zipPath: string;
  title: string | null;
  navLevel: number;
};

export type EpubAsset = { zipPath: string; mediaType: string };

/**
 * One line of the book's own table of contents.
 *
 * The nav is not the spine. The spine is reading order — every file, including
 * the cover and the copyright page. The nav is what the author decided the
 * contents are: its own order, its own nesting, and entries that frequently
 * point at an anchor *inside* a file rather than at the file itself. Rendering
 * the spine and calling it a contents list produces exactly the jumble that
 * sounds like, which is why both are kept.
 */
export type NavEntry = {
  title: string;
  /** 1-based nesting depth in the contents tree. */
  level: number;
  zipPath: string;
  /** Anchor within the file, when the entry points into the middle of one. */
  fragment: string | null;
};

export type EpubMeta = {
  title: string | null;
  creator: string | null;
  language: string | null;
  publisher: string | null;
};

export type EpubBook = {
  opfPath: string;
  meta: EpubMeta;
  spine: EpubSpineEntry[];
  /** The book's own contents, in its own order. Empty when it shipped none. */
  nav: NavEntry[];
  assets: EpubAsset[];
  coverPath: string | null;
  coverMediaType: string | null;
  /** Comics and illustrated books; they page badly in reflowed columns. */
  fixedLayout: boolean;
  readText(zipPath: string): Promise<string | null>;
  readBinary(zipPath: string): Promise<Buffer | null>;
};

/** fast-xml-parser collapses a single-element list to a bare object. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) {
    const t = (v as { "#text": unknown })["#text"];
    return typeof t === "string" ? t.trim() || null : null;
  }
  return null;
}

/**
 * Encryption in an ePub is not automatically DRM.
 *
 * The same `META-INF/encryption.xml` carries font obfuscation, which the IDPF
 * and Adobe both specify and which every reader is expected to handle — the
 * book itself is perfectly readable. Rejecting on the file's mere presence
 * would turn away a large number of legitimate books, so only an algorithm we
 * do not recognise counts as DRM.
 */
const FONT_OBFUSCATION = [
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
];

function isDrm(encryptionXml: string): boolean {
  const algorithms = [...encryptionXml.matchAll(/Algorithm=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (algorithms.length === 0) return true; // encrypted, and it won't say how
  return algorithms.some((a) => !FONT_OBFUSCATION.includes(a));
}

/**
 * Titles from an EPUB 3 `nav.xhtml`.
 *
 * Parsed by scanning rather than by XML: real nav documents are full of
 * namespaces, inline markup inside the anchor text, and the occasional
 * unescaped ampersand, and a scanner tolerates all of it. Nesting depth comes
 * from the `<ol>` stack, which is what gives sub-chapters their indent.
 */
export function parseNavDocument(html: string, navPath: string): NavEntry[] {
  const out: NavEntry[] = [];

  // Prefer the toc nav; a nav document may also hold landmarks and a page list.
  const tocMatch = /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(html);
  const scope = tocMatch ? tocMatch[1] : html;

  const token = /<(\/?)(ol|a)\b([^>]*)>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;

  while ((m = token.exec(scope)) !== null) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (tag === "ol") {
      depth = closing ? Math.max(0, depth - 1) : depth + 1;
      continue;
    }
    if (closing) continue;

    const href = /href\s*=\s*["']([^"']*)["']/i.exec(m[3])?.[1];
    if (!href) continue;

    // Anchor text runs to the matching </a>; inner markup is stripped.
    const close = scope.indexOf("</a>", token.lastIndex);
    if (close === -1) continue;
    const title = scope
      .slice(token.lastIndex, close)
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/gi, "&")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;

    const zipPath = resolveHref(navPath, href);
    if (!zipPath) continue;
    out.push({
      title: title.slice(0, 300),
      level: Math.max(1, depth),
      zipPath,
      fragment: splitFragment(href).fragment,
    });
  }

  return out;
}

/**
 * Chapter names, for the one place a spine entry needs one: the reader's
 * header. First nav entry per file wins — a file's own name beats the name of
 * some section inside it.
 */
export function navTitlesByPath(entries: NavEntry[]): Map<string, { title: string; level: number }> {
  const out = new Map<string, { title: string; level: number }>();
  for (const e of entries) {
    if (!out.has(e.zipPath)) out.set(e.zipPath, { title: e.title, level: e.level });
  }
  return out;
}

/** Titles from an EPUB 2 `toc.ncx`, which nests properly and parses cleanly. */
export function parseNcx(ncxXml: string, ncxPath: string): NavEntry[] {
  const out: NavEntry[] = [];
  let doc: unknown;
  try {
    doc = xml.parse(ncxXml);
  } catch {
    return out;
  }

  type NavPoint = {
    navLabel?: { text?: unknown };
    content?: { "@_src"?: string };
    navPoint?: NavPoint | NavPoint[];
  };

  const walk = (points: NavPoint[], level: number) => {
    for (const p of points) {
      const src = p.content?.["@_src"];
      const title = textOf(p.navLabel?.text);
      if (src && title) {
        const zipPath = resolveHref(ncxPath, src);
        if (zipPath) {
          out.push({
            title: title.slice(0, 300),
            level,
            zipPath,
            fragment: splitFragment(src).fragment,
          });
        }
      }
      const kids = asArray(p.navPoint);
      if (kids.length > 0) walk(kids, level + 1);
    }
  };

  const root = (doc as { ncx?: { navMap?: { navPoint?: NavPoint | NavPoint[] } } })?.ncx?.navMap;
  walk(asArray(root?.navPoint), 1);
  return out;
}

export async function openEpub(buffer: Buffer): Promise<EpubBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new EpubError("invalid", "This file could not be opened as an ePub.");
  }

  // Case-insensitive fallback index. Plenty of real books reference
  // `Images/Cover.JPG` while the archive holds `images/cover.jpg`; every
  // desktop reader tolerates it, and without this those files simply vanish.
  const byLowerName = new Map<string, string>();
  zip.forEach((relativePath) => {
    const key = relativePath.toLowerCase();
    if (!byLowerName.has(key)) byLowerName.set(key, relativePath);
  });

  const entry = (zipPath: string) => {
    const exact = zip.file(zipPath);
    if (exact) return exact;
    const fallback = byLowerName.get(zipPath.toLowerCase());
    return fallback ? zip.file(fallback) : null;
  };

  const readText = async (zipPath: string): Promise<string | null> => {
    const f = entry(zipPath);
    return f ? f.async("string") : null;
  };
  const readBinary = async (zipPath: string): Promise<Buffer | null> => {
    const f = entry(zipPath);
    return f ? Buffer.from(await f.async("nodebuffer")) : null;
  };

  const encryption = await readText("META-INF/encryption.xml");
  if (encryption && isDrm(encryption)) {
    throw new EpubError(
      "drm",
      "This book is DRM-protected, so its text cannot be opened. A DRM-free copy will work.",
    );
  }

  const containerXml = await readText("META-INF/container.xml");
  if (!containerXml) throw new EpubError("invalid", "Not an ePub: META-INF/container.xml is missing.");

  let opfPath: string | null = null;
  try {
    const container = xml.parse(containerXml);
    const rootfiles = asArray(container?.container?.rootfiles?.rootfile);
    opfPath = normalizeZipPath(rootfiles[0]?.["@_full-path"] ?? "");
  } catch {
    opfPath = null;
  }
  if (!opfPath) throw new EpubError("invalid", "Not an ePub: no package document declared.");

  const opfXml = await readText(opfPath);
  if (!opfXml) throw new EpubError("invalid", `Not an ePub: package document missing at ${opfPath}.`);

  let opf: Record<string, unknown>;
  try {
    opf = xml.parse(opfXml);
  } catch {
    throw new EpubError("invalid", "This book's package document is malformed.");
  }

  const pkg = (opf as { package?: Record<string, unknown> }).package;
  if (!pkg) throw new EpubError("invalid", "This book's package document is malformed.");

  // ── metadata ──────────────────────────────────────────────────────────
  const metaNode = (pkg.metadata ?? {}) as Record<string, unknown>;
  const meta: EpubMeta = {
    title: textOf(asArray(metaNode["dc:title"] ?? metaNode.title)[0]),
    creator: textOf(asArray(metaNode["dc:creator"] ?? metaNode.creator)[0]),
    language: textOf(asArray(metaNode["dc:language"] ?? metaNode.language)[0]),
    publisher: textOf(asArray(metaNode["dc:publisher"] ?? metaNode.publisher)[0]),
  };

  const metaTags = asArray(metaNode.meta) as Record<string, unknown>[];
  const fixedLayout = metaTags.some(
    (m) =>
      m["@_property"] === "rendition:layout" &&
      String(m["#text"] ?? "").trim() === "pre-paginated",
  );

  // ── manifest ──────────────────────────────────────────────────────────
  const manifestItems = asArray(
    (pkg.manifest as { item?: unknown })?.item,
  ) as Record<string, string>[];

  type ManifestEntry = { id: string; zipPath: string; mediaType: string; properties: string };
  const byId = new Map<string, ManifestEntry>();
  for (const item of manifestItems) {
    const id = item["@_id"];
    const href = item["@_href"];
    if (!id || !href) continue;
    const zipPath = resolveHref(opfPath, href);
    if (!zipPath) continue;
    byId.set(id, {
      id,
      zipPath,
      mediaType: item["@_media-type"] ?? "application/octet-stream",
      properties: item["@_properties"] ?? "",
    });
  }

  // ── spine ─────────────────────────────────────────────────────────────
  const spineNode = (pkg.spine ?? {}) as Record<string, unknown>;
  const itemrefs = asArray(spineNode.itemref) as Record<string, string>[];

  const spinePaths: string[] = [];
  const seen = new Set<string>();
  for (const ref of itemrefs) {
    const item = byId.get(ref["@_idref"]);
    if (!item) continue;
    // A book may list the same document twice; the reader needs one page per
    // position, and a duplicate would give two spine indices the same anchor.
    if (seen.has(item.zipPath)) continue;
    if (!entry(item.zipPath)) continue;
    seen.add(item.zipPath);
    spinePaths.push(item.zipPath);
  }
  if (spinePaths.length === 0) {
    throw new EpubError("invalid", "This book has no readable chapters.");
  }

  // ── table of contents ─────────────────────────────────────────────────
  let nav: NavEntry[] = [];

  const navEntry = [...byId.values()].find((e) => /\bnav\b/.test(e.properties));
  if (navEntry) {
    const navHtml = await readText(navEntry.zipPath);
    if (navHtml) nav = parseNavDocument(navHtml, navEntry.zipPath);
  }
  if (nav.length === 0) {
    const ncxId = spineNode["@_toc"] as string | undefined;
    const ncxEntry =
      (ncxId ? byId.get(ncxId) : undefined) ??
      [...byId.values()].find((e) => e.mediaType === "application/x-dtbncx+xml");
    if (ncxEntry) {
      const ncxXml = await readText(ncxEntry.zipPath);
      if (ncxXml) nav = parseNcx(ncxXml, ncxEntry.zipPath);
    }
  }

  const titles = navTitlesByPath(nav);

  const spine: EpubSpineEntry[] = spinePaths.map((zipPath, idx) => {
    const hit = titles.get(zipPath);
    return { idx, zipPath, title: hit?.title ?? null, navLevel: hit?.level ?? 1 };
  });

  // ── cover ─────────────────────────────────────────────────────────────
  const coverEntry =
    [...byId.values()].find((e) => /\bcover-image\b/.test(e.properties)) ??
    (() => {
      const pointer = metaTags.find((m) => m["@_name"] === "cover")?.["@_content"];
      return typeof pointer === "string" ? byId.get(pointer) : undefined;
    })() ??
    [...byId.values()].find(
      (e) => e.mediaType.startsWith("image/") && /cover/i.test(e.id + e.zipPath),
    );

  // ── assets ────────────────────────────────────────────────────────────
  const spineSet = new Set(spinePaths);
  const assets: EpubAsset[] = [...byId.values()]
    .filter(
      (e) =>
        !spineSet.has(e.zipPath) &&
        (e.mediaType.startsWith("image/") || e.mediaType.startsWith("font/") ||
          /vnd\.ms-opentype|application\/x-font|application\/font/.test(e.mediaType)),
    )
    .map((e) => ({ zipPath: e.zipPath, mediaType: e.mediaType }));

  const spineSetForNav = new Set(spinePaths);

  return {
    opfPath,
    meta,
    spine,
    // Only entries landing on a file the spine actually renders: a nav can
    // point at something outside reading order, and that is not navigable.
    nav: nav.filter((e) => spineSetForNav.has(e.zipPath)),
    assets,
    coverPath: coverEntry?.zipPath ?? null,
    coverMediaType: coverEntry?.mediaType ?? null,
    fixedLayout,
    readText,
    readBinary,
  };
}

/** Where the spine index for a zip path lives, for chapter-to-chapter links. */
export function spineIndexByPath(spine: EpubSpineEntry[]): Map<string, number> {
  return new Map(spine.map((s) => [s.zipPath, s.idx]));
}

export { dirOf, normalizeZipPath, resolveHref };

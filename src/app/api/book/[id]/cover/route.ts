import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { bookPaths, getBookObject, putBookObject, type FetchedObject } from "@/lib/books/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wide enough to stay sharp on a 3x phone at the size the shelf draws it. */
const THUMB_WIDTH = 240;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/book/:id/cover — the book's cover, at shelf size.
 *
 * A cover inside an ePub is a print-resolution image: routinely 1600px wide and
 * a megabyte or more. Sending that to fill a 56px box wastes the reader's data
 * and decodes slowly on a phone for no visible gain.
 *
 * The rendition is generated on first request rather than at upload, so books
 * ingested before this existed get one too, without being re-uploaded. It is
 * stored, so the cost is paid once per book. If anything about the resize fails
 * — an image format sharp will not read, sharp missing from the runtime — the
 * original is served instead, which is only ever slower, never broken.
 *
 * ## Why there is no database query here
 *
 * A shelf issues one of these per book, so everything this route does is
 * multiplied by the size of someone's library — and a folder that got slower
 * with every ePub added was exactly that multiplication. Looking the document
 * up bought nothing: the bucket path is built from the VERIFIED user id and the
 * document id, so an object under `<me>/<doc>/cover` is mine by construction,
 * and one belonging to anybody else is unreachable by any id a caller can send.
 * A document that does not exist simply has no object, which is the 404 the
 * lookup would have produced anyway.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status ?? 401 });

  // The id becomes part of a storage path, so it has to be a uuid and nothing
  // else — a value with slashes in it would address somebody else's prefix.
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const paths = bookPaths(user.id, id);
  let object: FetchedObject | null = await getBookObject(paths.coverThumb);

  if (!object) {
    const full = await getBookObject(paths.cover);
    if (!full) return NextResponse.json({ error: "No cover" }, { status: 404 });

    object = full;
    try {
      const sharp = (await import("sharp")).default;
      const body = await sharp(full.body)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      object = { body, contentType: "image/webp" };
      // Stored in the background: a storage hiccup should cost the next reader
      // one more resize, not this reader their cover.
      void putBookObject(paths.coverThumb, body, "image/webp").catch(() => {});
    } catch {
      // Serve the original untouched.
    }
  }

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      // A cover never changes: the file it came from is immutable and the
      // rendition is derived from it. A week of `immutable` means a shelf
      // revisited tomorrow issues no requests at all — which matters far more
      // than what this route costs, because the count scales with the library.
      "Cache-Control": "private, max-age=604800, immutable",
      // For anything that ignores `immutable` and revalidates anyway: the
      // object is content-addressed by its path, so its identity is its path.
      ETag: `"${paths.coverThumb}"`,
    },
  });
}

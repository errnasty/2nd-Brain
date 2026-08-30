import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { loadBookDoc } from "@/lib/books/access";
import { bookPaths, getBookObject, putBookObject, type FetchedObject } from "@/lib/books/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wide enough to stay sharp on a 3x phone at the size the shelf draws it. */
const THUMB_WIDTH = 240;

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
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status ?? 401 });

  const doc = await loadBookDoc(id, user.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const paths = bookPaths(doc.userId, doc.id);
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
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}

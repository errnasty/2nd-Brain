import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { loadBookDoc } from "@/lib/books/access";
import { normalizeZipPath } from "@/lib/books/paths";
import { bookPaths, getBookObject } from "@/lib/books/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/book/:id/asset/*
 *
 * An image or font from inside a book, at the path it had in the archive.
 *
 * The path comes from the URL, so it is normalized before it is used: a book
 * that asks for `../../../` is either broken or hostile, and the bucket is read
 * with a key that bypasses RLS. `normalizeZipPath` returns null for anything
 * that climbs above the book's own root, and that is the whole guard.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status ?? 401 });

  // Next.js has already URI-decoded these segments; decoding again would throw
  // on any filename containing a literal '%'.
  const zipPath = normalizeZipPath(path.join("/"));
  if (!zipPath) return NextResponse.json({ error: "Bad asset path" }, { status: 400 });

  const doc = await loadBookDoc(id, user.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const object = await getBookObject(bookPaths(doc.userId, doc.id).asset(zipPath));
  if (!object) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

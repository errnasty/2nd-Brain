import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { loadBookDoc } from "@/lib/books/access";
import { bookPaths, getBookObject } from "@/lib/books/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/book/:id/cover — the book's cover image, if it shipped with one. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status ?? 401 });

  const doc = await loadBookDoc(id, user.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const object = await getBookObject(bookPaths(doc.userId, doc.id).cover);
  if (!object) return NextResponse.json({ error: "No cover" }, { status: 404 });

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}

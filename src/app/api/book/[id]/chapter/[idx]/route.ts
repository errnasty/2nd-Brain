import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { loadBookDoc } from "@/lib/books/access";
import { bookPaths, getBookObject } from "@/lib/books/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/book/:id/chapter/:idx
 *
 * One chapter, already sanitized and rewritten at upload time. No unzip, no
 * whole-book download — this is the request a page turn makes, so it stays a
 * single small object fetch.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; idx: string }> },
) {
  const { id, idx } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status ?? 401 });

  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0) {
    return NextResponse.json({ error: "Bad chapter" }, { status: 400 });
  }

  const doc = await loadBookDoc(id, user.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const object = await getBookObject(bookPaths(doc.userId, doc.id).chapter(n));
  if (!object) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A chapter is written once and never rewritten: re-uploading a book
      // produces a new document id, so the URL is effectively immutable.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

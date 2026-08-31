import { NextResponse } from "next/server";
import { uploadToDirectoryAction } from "@/app/(app)/directory/actions";

export const runtime = "nodejs";
// Ingesting a book is unzip, chapter extraction, chunking and several batched
// inserts. A big ePub takes a while, and a severed response here is a failed
// upload with a file already half-written.
export const maxDuration = 300;

/**
 * POST /api/directory/upload — the same upload as the Server Action, over HTTP.
 *
 * ## Why this exists next to the action
 *
 * A Server Action gives no way to observe the request body being sent. The
 * browser is uploading fifty megabytes and `fetch` reports nothing until it is
 * finished, so the only honest thing to show was a spinner — for a minute, on a
 * slow connection, with no way to tell a slow upload from a stuck one. The one
 * API that does report progress is `XMLHttpRequest.upload.onprogress`, and it
 * needs a URL to post to.
 *
 * So this is a thin door onto exactly the same code: the action is called with
 * the FormData this request carried, which keeps validation, limits, ingestion
 * and revalidation in one place. Nothing here decides anything.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    // Usually a body truncated by a proxy limit before it ever arrived, which
    // reports as a malformed form and says nothing about size.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Couldn't read the upload" },
      { status: 400 },
    );
  }

  // The action authenticates, validates and reports its own failures as a typed
  // result, so a rejection here is the framework failing around it.
  const result = await uploadToDirectoryAction(form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

"use client";

/**
 * Uploading a file with a progress bar that means something.
 *
 * ## Why XMLHttpRequest
 *
 * Not nostalgia: it is still the only browser API that reports how much of a
 * request body has gone out. `fetch` has no upload-progress event at all, and a
 * Server Action has no request to observe in the first place. Without one of
 * these events the only honest UI for a fifty-megabyte ePub on a hotel wifi is
 * a spinner that sits there for a minute, indistinguishable from a stuck one.
 *
 * ## Two phases, and why the bar stops at the first
 *
 * Sending the bytes is measurable; ingesting them is not. Once the last byte is
 * away the server unzips the book, splits it into chapters, chunks the text and
 * writes several batches — tens of seconds on a big book, with no signal the
 * browser can see. So the bar fills as the file goes up and then hands over to
 * an indeterminate "Processing", which is the truth: the upload IS done, and
 * what is left has no percentage.
 */

import {
  finishGenerationJob,
  startGenerationJob,
  updateGenerationJob,
} from "@/lib/ui/generation-jobs";

export type UploadResult =
  | { ok: true; itemId: string; chunkCount: number }
  | { ok: false; error: string };

/** Progress is reported in whole percent — the bar cannot show more than that. */
const SCALE = 100;

/**
 * Post `file` to the Directory, showing its progress in the app's status strip.
 *
 * Resolves with the server's own typed result rather than throwing, so a
 * rejected upload and a failed one are handled the same way by the caller.
 */
export function uploadFileWithProgress(
  file: File,
  folderId: string | null,
): Promise<UploadResult> {
  const jobId = startGenerationJob(`Uploading ${file.name}`, SCALE);

  return new Promise<UploadResult>((resolve) => {
    const form = new FormData();
    form.set("file", file);
    if (folderId) form.set("folderId", folderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/directory/upload");

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      updateGenerationJob(jobId, { done: Math.round((e.loaded / e.total) * SCALE) });
    });

    // The bytes are away; everything after this is server-side work with no
    // percentage to report. `total: 0` is what the strip renders as a
    // travelling sliver rather than a bar frozen at 100%.
    xhr.upload.addEventListener("load", () => {
      updateGenerationJob(jobId, { label: `Processing ${file.name}`, done: 0, total: 0 });
    });

    const settle = (result: UploadResult) => {
      finishGenerationJob(jobId);
      resolve(result);
    };

    xhr.addEventListener("load", () => {
      try {
        const body = JSON.parse(xhr.responseText) as UploadResult;
        // A body without `ok` is not this route answering — a proxy error page,
        // most likely — and must not be reported as a success.
        if (typeof body?.ok !== "boolean") throw new Error(xhr.statusText || "Upload failed");
        settle(body);
      } catch {
        settle({
          ok: false,
          error:
            xhr.status === 413
              ? "That file is too large to upload."
              : `Upload failed (${xhr.status || "no response"})`,
        });
      }
    });

    xhr.addEventListener("error", () =>
      settle({ ok: false, error: "Upload failed — check your connection." }),
    );
    xhr.addEventListener("abort", () => settle({ ok: false, error: "Upload cancelled" }));

    xhr.send(form);
  });
}

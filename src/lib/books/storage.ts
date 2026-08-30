import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Bucket I/O for books.
 *
 * Everything is written once at upload and read many times, so the layout is
 * chosen for cheap reads: one flat object per chapter, addressable by spine
 * index, with no unzip on the read path.
 *
 *   {userId}/{docId}.epub              the original, kept
 *   {userId}/{docId}/ch/{idx}.html     one sanitized chapter
 *   {userId}/{docId}/assets/{zipPath}  images and fonts, at their book paths
 *   {userId}/{docId}/cover             the cover image
 *
 * The leading `{userId}` segment is load-bearing: the bucket's RLS policies
 * scope a user to the folder named after their id.
 */

export const BOOKS_BUCKET = "books";

export function bookPaths(userId: string, documentId: string) {
  const prefix = `${userId}/${documentId}`;
  return {
    prefix,
    epub: `${prefix}.epub`,
    chapter: (idx: number) => `${prefix}/ch/${idx}.html`,
    asset: (zipPath: string) => `${prefix}/assets/${zipPath}`,
    cover: `${prefix}/cover`,
  };
}

export class BookStorageUnavailable extends Error {
  constructor() {
    super("Book storage is not configured (SUPABASE_SERVICE_ROLE_KEY is missing).");
    this.name = "BookStorageUnavailable";
  }
}

function bucket() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new BookStorageUnavailable();
  return admin.storage.from(BOOKS_BUCKET);
}

/** True when the service-role key is present, so callers can degrade politely. */
export function bookStorageConfigured(): boolean {
  return createSupabaseAdminClient() !== null;
}

export async function putBookObject(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await bucket().upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed for ${path}: ${error.message}`);
}

export type FetchedObject = { body: Buffer; contentType: string };

export async function getBookObject(path: string): Promise<FetchedObject | null> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return {
    body: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || "application/octet-stream",
  };
}

/**
 * Delete everything belonging to one book.
 *
 * Storage has no recursive delete and assets keep their nested book paths, so
 * the tree is walked. Failures are swallowed by the caller: an orphaned object
 * costs a little quota, while a throw here would block deleting the document.
 */
export async function removeBookObjects(userId: string, documentId: string): Promise<void> {
  const b = bucket();
  const { prefix, epub } = bookPaths(userId, documentId);

  const walk = async (folder: string): Promise<string[]> => {
    const { data, error } = await b.list(folder, { limit: 1000 });
    if (error || !data) return [];
    const files: string[] = [];
    for (const entry of data) {
      const child = `${folder}/${entry.name}`;
      // Storage marks a synthetic folder row with a null id.
      if (entry.id === null) files.push(...(await walk(child)));
      else files.push(child);
    }
    return files;
  };

  const paths = [epub, ...(await walk(prefix))];
  // remove() caps at 1000 paths per call.
  for (let i = 0; i < paths.length; i += 1000) {
    await b.remove(paths.slice(i, i + 1000));
  }
}

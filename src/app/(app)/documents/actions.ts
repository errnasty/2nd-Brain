"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { documentChunks, documents } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { detectKind, extractByKind } from "@/lib/documents/extract";
import { chunkText } from "@/lib/documents/chunker";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB hard cap (Vercel default is 4.5MB — this allows local dev with bigger files)

export type UploadResult =
  | { ok: true; documentId: string; chunkCount: number }
  | { ok: false; error: string };

export async function uploadDocumentAction(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const folderId = (formData.get("folderId") as string | null) || null;

  if (!file || !(file instanceof File)) {
    return { ok: false, error: "No file provided" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File exceeds ${MAX_BYTES / 1024 / 1024}MB` };
  }
  const kind = detectKind(file.name, file.type);
  if (!kind) {
    return { ok: false, error: "Unsupported file type. Allowed: .pdf, .md, .txt, .epub" };
  }

  const { user } = await requireUser();

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, pageCount } = await extractByKind(kind, buffer);
    if (!text || text.trim().length === 0) {
      return { ok: false, error: "No text could be extracted from this file" };
    }

    const title = file.name.replace(/\.[^.]+$/, "");
    const [doc] = await db
      .insert(documents)
      .values({
        userId: user.id,
        folderId,
        title,
        kind,
        sizeBytes: file.size,
        pageCount,
        fullText: text,
        metadata: { originalName: file.name, mimeType: file.type },
      })
      .returning({ id: documents.id });

    // Chunk the text — embeddings happen in Phase 4 (left null for now).
    const chunks = chunkText(text);
    if (chunks.length > 0) {
      await db.insert(documentChunks).values(
        chunks.map((c) => ({
          documentId: doc.id,
          userId: user.id,
          chunkIndex: c.index,
          content: c.text,
          tokenCount: c.approxTokens,
        })),
      );
    }

    revalidatePath("/documents");
    return { ok: true, documentId: doc.id, chunkCount: chunks.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export async function deleteDocumentAction(id: string) {
  const { user } = await requireUser();
  await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, user.id)));
  revalidatePath("/documents");
}

export async function renameDocumentAction(id: string, title: string) {
  const { user } = await requireUser();
  await db
    .update(documents)
    .set({ title: title.trim() })
    .where(and(eq(documents.id, id), eq(documents.userId, user.id)));
  revalidatePath("/documents");
}

export async function moveDocumentAction(id: string, folderId: string | null) {
  const { user } = await requireUser();
  await db
    .update(documents)
    .set({ folderId })
    .where(and(eq(documents.id, id), eq(documents.userId, user.id)));
  revalidatePath("/documents");
}

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, folders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { DocumentsPanel } from "@/components/documents/documents-panel";

type Search = Promise<{ doc?: string }>;

export default async function DocumentsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { user } = await requireUser();

  const [docs, userFolders] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        kind: documents.kind,
        pageCount: documents.pageCount,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.userId, user.id))
      .orderBy(desc(documents.createdAt)),
    db.select().from(folders).where(eq(folders.userId, user.id)),
  ]);

  const selected = sp.doc
    ? await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, sp.doc), eq(documents.userId, user.id)))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  return <DocumentsPanel documents={docs} folders={userFolders} selected={selected} />;
}

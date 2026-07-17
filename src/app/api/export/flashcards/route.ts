import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFlashcards, directoryItems } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { toCsv } from "@/lib/export/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/flashcards
 *
 * All of a user's flashcards as CSV (question, answer, deck) — Anki imports
 * CSV directly with a front/back/deck column mapping. `deck` groups by the
 * card's source item (or "General" for cards with none, e.g. from a
 * selection/takeaway).
 */
export async function GET() {
  const { user, error } = await getApiUser();
  if (!user) return new Response(error?.message ?? "Unauthorized", { status: error?.status ?? 401 });

  const cards = await db
    .select({
      question: directoryFlashcards.question,
      answer: directoryFlashcards.answer,
      itemTitle: directoryItems.title,
    })
    .from(directoryFlashcards)
    .leftJoin(directoryItems, eq(directoryItems.id, directoryFlashcards.itemId))
    .where(eq(directoryFlashcards.userId, user.id));

  const rows = [
    ["question", "answer", "deck"],
    ...cards.map((c) => [c.question, c.answer, c.itemTitle ?? "General"]),
  ];
  const csv = toCsv(rows);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="flashcards.csv"`,
    },
  });
}

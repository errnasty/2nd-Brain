import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { conceptSlug } from "@/lib/thinktank/concept-slug";
import { reserveConcept, setConceptFamiliarity } from "@/lib/thinktank/concepts";

export const runtime = "nodejs";

/**
 * "I know this" / "actually I don't", from the Discover screen.
 *
 * Records the correction against the concept so future Discover runs stop
 * suggesting it. The concept is RESERVED rather than required to exist: the
 * user is usually correcting a suggestion they never opened, so there is no
 * row yet. Reserving costs nothing — a pending concept with no card is just a
 * note that they've seen the name.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; slug?: string; topic?: string | null; familiarity?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const slug = body.slug ? conceptSlug(body.slug) : name ? conceptSlug(name) : "";
  if (!slug) return NextResponse.json({ error: "name or slug required" }, { status: 400 });

  const familiarity =
    body.familiarity === "known" ? "known" : body.familiarity === "new" ? "new" : null;

  const reserved = await reserveConcept(user.id, name || slug, body.topic ?? null);
  if (!reserved) return NextResponse.json({ error: "Not a usable concept" }, { status: 400 });

  await setConceptFamiliarity(user.id, reserved.row.slug, familiarity);
  return NextResponse.json({ ok: true });
}

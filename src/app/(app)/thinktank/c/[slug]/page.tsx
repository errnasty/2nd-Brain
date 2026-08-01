import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankSaved } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { conceptSlug } from "@/lib/thinktank/concept-slug";
import { getConcept, markConceptViewed, reserveConcept } from "@/lib/thinktank/concepts";
import { ConceptCard, type ConceptView } from "@/components/thinktank/concept-card";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ topic?: string; name?: string }>;

/**
 * One concept in the Explore graph.
 *
 * A slug that doesn't exist yet is RESERVED here rather than 404'd: arriving at
 * a concept is how you ask for it to be written. The row is created pending and
 * the client kicks generation, which is what makes the graph feel endless —
 * every link goes somewhere, whether or not that card has ever been written.
 */
export default async function ConceptPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { slug: rawSlug } = await params;
  const sp = await searchParams;
  const { user } = await requireUser();

  const slug = conceptSlug(decodeURIComponent(rawSlug));
  const topic = sp.topic ? decodeURIComponent(sp.topic) : null;

  let concept = await getConcept(user.id, slug);
  if (!concept) {
    // The display name is whatever the link carried; the slug is the identity.
    // Un-slugifying is a fallback for a hand-typed URL, not the normal path.
    const name = sp.name ? decodeURIComponent(sp.name) : slug.replace(/-/g, " ");
    const reserved = await reserveConcept(user.id, name, topic);
    concept = reserved?.row ?? null;
  }

  if (!concept) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          That isn&apos;t a concept we can write about.
        </p>
      </div>
    );
  }

  // Fire-and-forget: a view counter must never delay or fail the render.
  void markConceptViewed(user.id, slug);

  const [savedRow] = await db
    .select({ id: thinktankSaved.id })
    .from(thinktankSaved)
    .where(and(eq(thinktankSaved.userId, user.id), eq(thinktankSaved.conceptId, concept.id)))
    .limit(1);

  const view: ConceptView = {
    slug: concept.slug,
    name: concept.name,
    topic: concept.topic ?? topic,
    status: concept.status,
    whatIsIt: concept.whatIsIt,
    whyItMatters: concept.whyItMatters,
    realWorldExample: concept.realWorldExample,
    related: concept.related ?? [],
    questions: concept.questions ?? [],
    saved: Boolean(savedRow),
    familiarity: concept.familiarity,
  };

  return <ConceptCard concept={view} />;
}

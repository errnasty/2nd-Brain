"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Brain, Check, RefreshCw, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ConceptLink, ConceptQuestion } from "@/lib/db/schema";

/**
 * One Explore card: what it is → why it matters → a real example → where next.
 *
 * The layout is deliberately rigid. A reader chaining through twenty of these
 * should never have to work out what shape the current card is before they can
 * read it — the four headings are always there, always in the same order, and
 * always the same length. Consistency is the product.
 */

export type ConceptView = {
  slug: string;
  name: string;
  topic: string | null;
  status: "pending" | "ready" | "error";
  whatIsIt: string | null;
  whyItMatters: string | null;
  realWorldExample: string | null;
  related: ConceptLink[];
  questions: ConceptQuestion[];
  saved: boolean;
  familiarity: "known" | "new" | null;
};

export function ConceptCard({
  concept,
  refresher = false,
}: {
  concept: ConceptView;
  /** Arrived from a due refresher — ask whether it stuck. */
  refresher?: boolean;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(concept.status !== "ready");
  const [error, setError] = useState<string | null>(null);
  const kicked = useRef(false);

  const generate = useCallback(async () => {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/thinktank/concept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: concept.slug, name: concept.name, topic: concept.topic }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Couldn't write this card");
        setGenerating(false);
        return;
      }
      router.refresh();
    } catch {
      // A severed response may still have written the card — refresh and let
      // the server say. Only a persistent failure surfaces as an error.
      router.refresh();
    }
  }, [concept.slug, concept.name, concept.topic, router]);

  // Generate on arrival when the card doesn't exist yet. Guarded so React's
  // dev double-invoke can't pay for the same card twice.
  useEffect(() => {
    if (kicked.current || concept.status === "ready") return;
    kicked.current = true;
    void generate();
  }, [concept.status, generate]);

  useEffect(() => {
    if (concept.status === "ready") setGenerating(false);
  }, [concept.status]);

  // Credit reading the card. Fires once the card is actually readable, not on
  // navigation — arriving at a pending card and leaving before it's written
  // isn't reading it. Idempotent per concept per day server-side.
  const credited = useRef(false);
  const [gain, setGain] = useState<{ amount: number; skill: string | null } | null>(null);
  const credit = useCallback(
    async (kind: "learned" | "tested") => {
      try {
        const res = await fetch("/api/thinktank/concept", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: concept.slug, kind }),
        });
        const body = (await res.json().catch(() => null)) as {
          awarded?: number;
          skill?: { name: string } | null;
        } | null;
        if (body?.awarded && body.awarded > 0) {
          setGain({ amount: body.awarded, skill: body.skill?.name ?? null });
        }
      } catch {
        // XP is a side effect of reading; losing it must never surface here.
      }
    },
    [concept.slug],
  );

  useEffect(() => {
    if (credited.current || concept.status !== "ready") return;
    credited.current = true;
    void credit("learned");
  }, [concept.status, credit]);

  // Prefetch what this card links to, so the next tap is instant. Fired once
  // the card itself is readable — never before, so speculative work can't
  // delay the thing the user is actually waiting for.
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current || concept.status !== "ready") return;
    prefetched.current = true;
    const targets = concept.related.slice(0, PREFETCH_COUNT);
    for (const link of targets) {
      void fetch("/api/thinktank/concept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: link.name,
          topic: concept.topic,
          cameFrom: concept.name,
          prefetch: true,
        }),
      }).catch(() => {
        // Speculative. A failure here is invisible by design.
      });
    }
  }, [concept.status, concept.related, concept.topic, concept.name]);

  if (concept.status !== "ready" || !concept.whatIsIt) {
    return (
      <ConceptShell name={concept.name} topic={concept.topic}>
        <div className="py-16 text-center">
          {error ? (
            <>
              <h2 className="editorial-display text-xl">Couldn&apos;t write this card.</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{error}</p>
              <Button variant="brand" size="sm" className="mt-5 gap-1.5" onClick={generate}>
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </Button>
            </>
          ) : (
            <>
              <Spinner className="mx-auto h-6 w-6 text-brand" />
              <p className="mt-4 text-sm text-muted-foreground">
                Writing “{concept.name}”…
              </p>
            </>
          )}
        </div>
      </ConceptShell>
    );
  }

  return (
    <ConceptShell name={concept.name} topic={concept.topic}>
      <Part label="What is it?">{concept.whatIsIt}</Part>
      <Part label="Why does it matter?">{concept.whyItMatters}</Part>
      <Part label="Real-world example">{concept.realWorldExample}</Part>

      <TestMe questions={concept.questions} onTested={() => credit("tested")} />

      {concept.related.length > 0 && (
        <section className="mt-8 border-t border-border/60 pt-5">
          <div className="editorial-eyebrow-brand">§ You might also like</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {concept.related.map((link) => (
              <Link
                key={link.slug}
                href={`/thinktank/c/${link.slug}${concept.topic ? `?topic=${encodeURIComponent(concept.topic)}` : ""}`}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-brand/50 hover:bg-accent"
              >
                {link.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {refresher && <RefresherPrompt slug={concept.slug} />}

      <SaveButton slug={concept.slug} initiallySaved={concept.saved} />
      {gain && (
        <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-brand">
          <Sparkles className="h-3 w-3" />+{gain.amount}
          {gain.skill ? ` ${gain.skill}` : ""}
        </p>
      )}
      {generating && (
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Refreshing…</p>
      )}
    </ConceptShell>
  );
}

/** Related concepts pre-generated per card. See the plan's cost discussion. */
const PREFETCH_COUNT = 2;

function ConceptShell({
  name,
  topic,
  children,
}: {
  name: string;
  topic: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-2">
          <Link
            href={topic ? `/thinktank/explore/${encodeURIComponent(topic)}` : "/thinktank"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {topic && <div className="editorial-eyebrow truncate">{topic}</div>}
        </div>
        <h1 className="editorial-display text-3xl">{name}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="editorial-eyebrow-brand">{label}</h2>
      <p className="mt-1.5 text-[1.05rem] leading-[1.6]">{children}</p>
    </section>
  );
}

/**
 * One or two questions that check the card landed.
 *
 * Self-marked, and deliberately not graded by a model: the questions came free
 * with the card, and adding a grading call would make checking your
 * understanding cost more than learning the thing did.
 */
function TestMe({
  questions,
  onTested,
}: {
  questions: ConceptQuestion[];
  onTested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  if (questions.length === 0) return null;

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-8 gap-1.5"
        onClick={() => {
          setOpen(true);
          onTested();
        }}
      >
        <Brain className="h-3.5 w-3.5" /> Test me
      </Button>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-card/50 p-4">
      <div className="editorial-eyebrow-brand">§ Test me</div>
      <ul className="mt-3 space-y-4">
        {questions.map((q, i) => (
          <li key={q.question}>
            <p className="text-sm font-medium">{q.question}</p>
            {revealed.has(i) ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{q.answer}</p>
            ) : (
              <button
                type="button"
                className="mt-1.5 text-xs text-brand underline-offset-2 hover:underline"
                onClick={() => setRevealed((prev) => new Set(prev).add(i))}
              >
                Show answer
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SaveButton({ slug, initiallySaved }: { slug: string; initiallySaved: boolean }) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    // Optimistic: the button is the feedback, and a bookmark that lags feels
    // broken even when it worked.
    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch("/api/thinktank/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, saved: next }),
      });
      if (!res.ok) setSaved(!next);
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-border/60 pt-5">
      <Button
        variant={saved ? "brand" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={toggle}
        disabled={busy}
      >
        {saved ? <Check className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
        {saved ? "Saved — we'll remind you" : "Save for later"}
      </Button>
      {saved && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          You&apos;ll get a two-minute refresher in a day, then a week, then a month.
        </p>
      )}
    </div>
  );
}

/**
 * The two-taps-and-done refresher.
 *
 * Deliberately a binary. A 0-5 recall grade is what FSRS needs and what this
 * mode promised not to ask for — "did that stick?" is the most a refresher can
 * demand without becoming homework.
 */
function RefresherPrompt({ slug }: { slug: string }) {
  const [answered, setAnswered] = useState<null | "remembered" | "forgot">(null);
  const [nextAt, setNextAt] = useState<string | null>(null);

  async function answer(outcome: "remembered" | "forgot") {
    setAnswered(outcome);
    try {
      const res = await fetch("/api/thinktank/refresher", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, outcome }),
      });
      const body = (await res.json().catch(() => null)) as { nextAt?: string | null } | null;
      setNextAt(body?.nextAt ?? null);
    } catch {
      // The schedule missed a beat; the concept stays due and comes back.
    }
  }

  if (answered) {
    return (
      <p className="mt-8 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
        {answered === "remembered" ? "Nice — " : "No problem — "}
        {nextAt
          ? `back on ${new Date(nextAt).toLocaleDateString([], { month: "short", day: "numeric" })}.`
          : "we'll bring it back."}
      </p>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-brand/30 bg-brand/5 p-4">
      <div className="editorial-eyebrow-brand">§ Refresher</div>
      <p className="mt-1.5 text-sm">Did that stick?</p>
      <div className="mt-3 flex gap-2">
        <Button variant="brand" size="sm" onClick={() => answer("remembered")}>
          Yes, I remembered
        </Button>
        <Button variant="outline" size="sm" onClick={() => answer("forgot")}>
          Not really
        </Button>
      </div>
    </section>
  );
}

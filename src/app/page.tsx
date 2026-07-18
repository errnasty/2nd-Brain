import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  Library,
  MessageCircle,
  Rss,
} from "lucide-react";
import { Constellation } from "@/components/landing/constellation";
import { Reveal } from "@/components/landing/reveal";
import { CORE_LOOP } from "@/data/guide";

export const metadata: Metadata = {
  title: "Second Brain — read, remember, and think with your knowledge",
  description:
    "A private home for everything you read, write, and want to remember — with an AI that actually knows your stuff. RSS reader, knowledge library, spaced-repetition study, and grounded AI chat.",
  openGraph: {
    title: "Second Brain",
    description:
      "Read, organize, distill, and express. Your private knowledge base with an AI that knows your stuff.",
    type: "website",
  },
};

// Set by src/lib/supabase/middleware.ts on verified requests (kept in sync there).
const VERIFIED_USER_HEADER = "x-sb-verified-user";

const PILLARS = [
  { icon: Rss, title: "Read", blurb: "RSS feeds and a daily AI brief bring the web to you — calm, not chaotic." },
  { icon: Library, title: "Organize", blurb: "A permanent library of articles, notes, and documents in folders and tags." },
  { icon: GraduationCap, title: "Study", blurb: "Distill anything into flashcards and let spaced repetition make it stick." },
  { icon: MessageCircle, title: "Ask", blurb: "Chat with your own knowledge and get answers with citations you can trust." },
];

export default async function LandingPage() {
  // Logged-in users (and the desktop app, which always has a session) skip the
  // marketing page and go straight into the app.
  if (process.env.APP_RUNTIME === "desktop") redirect("/today");
  const h = await headers();
  if (h.get(VERIFIED_USER_HEADER)) redirect("/today");

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Hero */}
      <section className="relative flex min-h-dvh flex-col overflow-hidden">
        <Constellation />
        {/* soft brand glow behind the headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/3 -z-0 h-[42vmin] w-[42vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl motion-safe:animate-[landing-glow_7s_ease-in-out_infinite]"
          style={{ background: "hsl(var(--brand) / 0.16)" }}
        />

        {/* top bar */}
        <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="editorial-eyebrow-brand">Second Brain</div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/guide" className="text-muted-foreground hover:text-foreground">
              Guide
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </header>

        {/* hero content */}
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 pb-20 text-center sm:px-8">
          <div className="editorial-eyebrow mb-5 motion-safe:animate-[landing-rise_0.6s_ease-out_both]">
            Vol. III · Personal Edition
          </div>
          <h1
            className="editorial-display motion-safe:animate-[landing-rise_0.7s_ease-out_both]"
            style={{ fontSize: "clamp(2.4rem, 8vw, 4.5rem)", lineHeight: 1.04 }}
          >
            <span className="block">Everything you read.</span>
            <span
              className="block motion-safe:[animation-delay:120ms] motion-safe:animate-[landing-rise_0.7s_ease-out_both]"
              style={{ color: "hsl(var(--brand))" }}
            >
              Actually remembered.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground motion-safe:[animation-delay:240ms] motion-safe:animate-[landing-rise_0.7s_ease-out_both] sm:text-base">
            A private home for your articles, notes, and documents — with an AI that answers from
            <em> your</em> knowledge, not the whole internet. Read, organize, distill, and express.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 motion-safe:[animation-delay:360ms] motion-safe:animate-[landing-rise_0.7s_ease-out_both] sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-semibold text-[hsl(var(--brand-foreground))] shadow-sm transition-transform hover:scale-[1.02]"
              style={{ background: "hsl(var(--brand))" }}
            >
              Get started — it&rsquo;s free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/guide"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-6 text-sm font-medium hover:bg-accent"
            >
              <BookOpen className="h-4 w-4" /> See how it works
            </Link>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto w-full max-w-5xl px-5 py-20 sm:px-8">
        <Reveal className="editorial-section-row mb-8">
          <span className="editorial-eyebrow">What it does</span>
          <span className="editorial-section-rule" />
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal as="div" key={p.title} delay={i * 90}>
                <div className="h-full rounded-2xl border border-border bg-card p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border">
                    <Icon className="h-5 w-5" style={{ color: "hsl(var(--brand))" }} />
                  </div>
                  <h3 className="editorial-display mt-4 text-xl">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.blurb}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* How it works — the core loop */}
      <section className="mx-auto w-full max-w-5xl px-5 py-10 pb-24 sm:px-8">
        <Reveal className="editorial-section-row mb-8">
          <span className="editorial-eyebrow">One simple loop</span>
          <span className="editorial-section-rule" />
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CORE_LOOP.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal as="div" key={s.step} delay={i * 90}>
                <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{s.step}</span>
                    <Icon className="h-4 w-4" style={{ color: "hsl(var(--brand))" }} />
                  </div>
                  <h3 className="mt-3 font-semibold">{s.label}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.blurb}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* closing CTA */}
        <Reveal className="mt-16 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <h2 className="editorial-display text-2xl sm:text-3xl">Build your Second Brain.</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Start free in under a minute. Your library, your notes, your AI — all private to you.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-semibold text-[hsl(var(--brand-foreground))]"
              style={{ background: "hsl(var(--brand))" }}
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              I already have an account
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:px-8">
          <span className="editorial-eyebrow-brand">Second Brain</span>
          <div className="flex items-center gap-4">
            <Link href="/guide" className="hover:text-foreground">
              Guide
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

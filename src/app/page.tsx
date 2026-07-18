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
import { Reveal } from "@/components/landing/reveal";
import { LandingReveal } from "@/components/landing/landing-reveal";

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

const VERIFIED_USER_HEADER = "x-sb-verified-user";

const PILLARS = [
  {
    roman: "I",
    label: "Read",
    icon: Rss,
    title: "Every feed, one calm river.",
    blurb: "RSS + a daily brief. No algorithm. No infinite scroll. Just what you subscribed to, in the order it came out.",
  },
  {
    roman: "II",
    label: "Organize",
    icon: Library,
    title: "A library, not a landfill.",
    blurb: "Articles, PDFs, notes, ePubs. Folders, tags, and search that actually finds what you meant.",
  },
  {
    roman: "III",
    label: "Study",
    icon: GraduationCap,
    title: "Distill. Then remember.",
    blurb: "One-click flashcards from any article. Spaced repetition does the boring work of making it stick.",
  },
  {
    roman: "IV",
    label: "Ask",
    icon: MessageCircle,
    title: "Chat with your own stuff.",
    blurb: "An AI that only reads what you've read. Every answer footnoted to the exact source it came from.",
  },
];

const COMPARE = [
  { feature: "RSS reader built in", notion: "—", readwise: "Partial", obsidian: "Plugin", sb: "✓ First-class" },
  { feature: "Spaced repetition", notion: "—", readwise: "Highlights only", obsidian: "Plugin", sb: "✓ Built in" },
  { feature: "Chat over your library, with citations", notion: "AI, not grounded", readwise: "—", obsidian: "Plugin, self-config", sb: "✓ With footnotes" },
  { feature: "Runs on your machine / your Postgres", notion: "—", readwise: "—", obsidian: "✓ Local files", sb: "✓ Self-hostable" },
  { feature: "Price", notion: "$10/mo", readwise: "$8/mo", obsidian: "Free / $8", sb: "Free · bring your own keys" },
];

export default async function LandingPage() {
  if (process.env.APP_RUNTIME === "desktop") redirect("/today");
  const h = await headers();
  if (h.get(VERIFIED_USER_HEADER)) redirect("/today");

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* ── MASTHEAD BAR ────────────────────────────────────────────── */}
      <header className="mx-auto w-full max-w-6xl border-b-4 border-double border-foreground px-5 pb-4 pt-5 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <div className="editorial-display text-xl font-bold">Second Brain</div>
            <div className="editorial-eyebrow hidden sm:block">Vol. III · Personal Edition</div>
          </div>
          <nav className="flex items-center gap-4 font-serif text-sm sm:gap-6">
            <Link href="/guide" className="text-muted-foreground hover:text-foreground">
              Guide
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="font-semibold underline decoration-2 underline-offset-2"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-foreground">
        <div className="landing-hero-glow" aria-hidden />
        <div className="relative mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
          {/* date / issue line */}
          <LandingReveal className="mb-8 flex items-baseline gap-4" delay={0}>
            <span className="editorial-eyebrow font-medium text-foreground">Saturday · July 18, 2026</span>
            <span className="landing-rule h-px flex-1 bg-foreground" />
            <span className="editorial-eyebrow">The Reading Issue</span>
          </LandingReveal>

          {/* staggered headline */}
          <LandingReveal>
            <h1
              className="lh-stagger editorial-display font-extrabold"
              style={{ fontSize: "clamp(2.6rem, 11vw, 8.5rem)", lineHeight: 0.92, letterSpacing: "-0.04em" }}
            >
              <span className="lh-line">Everything</span>
              <span className="lh-line">you read.</span>
              <span className="lh-line font-medium italic">Actually remembered.</span>
            </h1>
          </LandingReveal>

          {/* pitch + publisher's note */}
          <div className="mt-12 grid grid-cols-1 gap-8 sm:mt-14 sm:grid-cols-[1fr_1px_1fr] sm:gap-10">
            <div>
              <div className="editorial-eyebrow mb-3">The pitch</div>
              <Reveal>
                <p className="font-serif text-lg leading-relaxed">
                  A private home for your articles, notes, and documents — with an AI that answers from{" "}
                  <em>your</em> knowledge, not the whole internet. Read, organize, distill, and ask.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    href="/signup"
                    className="landing-btn-primary inline-flex h-12 items-center gap-2 rounded-none px-6 text-sm font-semibold text-background"
                    style={{ background: "hsl(var(--foreground))" }}
                  >
                    Start your Second Brain <ArrowRight className="landing-arr h-4 w-4" />
                  </Link>
                  <Link
                    href="/guide"
                    className="landing-btn-secondary inline-flex h-12 items-center gap-2 rounded-none border border-foreground px-5 text-sm font-medium"
                  >
                    <BookOpen className="h-4 w-4" /> See how it works
                  </Link>
                </div>
              </Reveal>
              <div className="mt-5 font-mono text-[11px] text-muted-foreground">
                Free · Self-hostable · Yours, forever
              </div>
            </div>

            <div className="hidden bg-foreground sm:block" />

            <div>
              <div className="editorial-eyebrow mb-3">Publisher&apos;s note</div>
              <Reveal>
                <p className="font-serif text-base italic leading-relaxed">
                  &ldquo;I built this because my bookmarks folder had 4,200 entries and I couldn&apos;t remember
                  reading any of them. I wanted a quiet room to keep everything I&apos;d ever found interesting — and
                  an assistant that had actually done the reading with me.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-3 font-serif text-base italic leading-relaxed">
                  If you also have too many open tabs, this might be for you.&rdquo;
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground font-serif text-base font-semibold text-background">
                    C
                  </div>
                  <div>
                    <div className="font-serif text-sm font-semibold">Cyrus H.</div>
                    <div className="editorial-eyebrow text-[10px]">Maker · One human</div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOUR PILLARS ────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl border-b border-foreground px-5 py-16 sm:px-8 sm:py-20">
        <LandingReveal className="mb-10 flex flex-wrap items-baseline gap-3" delay={0}>
          <span className="editorial-eyebrow font-medium text-foreground">§ 01</span>
          <div className="editorial-display text-2xl font-semibold sm:text-[2rem]">
            Four things it does. That&apos;s the whole app.
          </div>
          <span className="landing-rule h-px flex-1 bg-border" />
        </LandingReveal>

        <div className="grid grid-cols-1 border-y border-foreground sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal as="div" key={p.label} delay={i * 90}>
                <div
                  className={
                    "landing-pillar h-full border-border p-6 sm:p-8" +
                    (i < PILLARS.length - 1 ? " border-b lg:border-b-0 lg:border-r" : "")
                  }
                >
                  <div className="mb-6 flex items-baseline gap-2">
                    <span className="landing-pillar-roman editorial-eyebrow font-medium text-foreground">{p.roman}</span>
                    <span className="landing-pillar-eyebrow editorial-eyebrow">{p.label}</span>
                    <Icon className="landing-pillar-eyebrow ml-auto h-4 w-4" />
                  </div>
                  <div className="landing-pillar-title editorial-display text-2xl font-semibold leading-tight">
                    {p.title}
                  </div>
                  <p className="landing-pillar-prose mt-3 font-serif text-sm leading-relaxed text-muted-foreground">
                    {p.blurb}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ── PRODUCT SCREENSHOTS (mocks) ────────────────────────────── */}
      <section className="border-b border-foreground bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <LandingReveal className="mb-10 flex flex-wrap items-baseline gap-3" delay={0}>
            <span className="editorial-eyebrow font-medium text-foreground">§ 02</span>
            <div className="editorial-display text-2xl font-semibold sm:text-[2rem]">
              What it actually looks like.
            </div>
            <span className="landing-rule h-px flex-1 bg-border" />
          </LandingReveal>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Today mini */}
            <Reveal as="div">
              <figure className="m-0">
                <div className="h-80 overflow-hidden border border-foreground bg-card">
                  <div className="flex items-baseline gap-3 border-b border-border px-5 py-3">
                    <span className="editorial-eyebrow font-medium text-foreground">Today</span>
                    <span className="editorial-eyebrow">Saturday · July 18</span>
                  </div>
                  <div className="p-5">
                    <div className="editorial-display text-2xl font-bold">Your morning brief.</div>
                    <div className="mt-1 font-serif text-xs italic text-muted-foreground">
                      4 sources · 37 unread · ≈ 12 min
                    </div>
                    <div className="mt-5 flex flex-col gap-4">
                      {[
                        { tag: "Macro", title: "Japan's yield curve is telling you something", body: "The 30y–10y spread is back to 2007 levels…" },
                        { tag: "Strategy", title: "The aggregation theory of LLM distribution", body: "Why model providers capture the value…" },
                        { tag: "Infrastructure", title: "Why megaprojects always run over" },
                      ].map((item) => (
                        <div key={item.title} className="border-l-2 border-foreground pl-3">
                          <div className="editorial-eyebrow mb-1 text-[9px]">{item.tag}</div>
                          <div className="font-serif text-sm font-semibold leading-snug">{item.title}</div>
                          {item.body && (
                            <div className="mt-1 font-serif text-xs leading-snug text-muted-foreground">{item.body}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <figcaption className="mt-3 flex items-baseline gap-2">
                  <span className="editorial-eyebrow font-medium text-foreground">Today</span>
                  <span className="font-serif text-sm text-muted-foreground">— a hand-written brief, drafted from what you&apos;ve saved.</span>
                </figcaption>
              </figure>
            </Reveal>

            {/* Feeds mini */}
            <Reveal as="div" delay={90}>
              <figure className="m-0">
                <div className="flex h-80 overflow-hidden border border-foreground bg-card">
                  <div className="w-1/3 shrink-0 border-r border-border bg-muted/40 p-4">
                    <div className="editorial-eyebrow mb-3 font-medium text-foreground">Feeds</div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between bg-foreground px-2 py-1 font-serif text-xs text-background">
                        <span>All</span><span className="font-mono text-[10px]">37</span>
                      </div>
                      <div className="flex justify-between px-2 py-1 font-serif text-xs text-muted-foreground">
                        <span>Starred</span><span className="font-mono text-[10px]">11</span>
                      </div>
                      <div className="flex justify-between px-2 py-1 font-serif text-xs text-muted-foreground">
                        <span>Read later</span><span className="font-mono text-[10px]">18</span>
                      </div>
                      <div className="editorial-eyebrow mt-3 px-2 text-[9px]">Folders</div>
                      <div className="px-2 py-1 font-serif text-xs text-muted-foreground">Macroeconomics · 8</div>
                      <div className="px-2 py-1 font-serif text-xs text-muted-foreground">AI &amp; Tooling · 14</div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden p-4">
                    <div className="mb-3 flex gap-1">
                      <span className="bg-foreground px-2 py-1 font-serif text-[11px] text-background">Unread</span>
                      <span className="font-serif text-[11px] text-muted-foreground">All</span>
                      <span className="font-serif text-[11px] text-muted-foreground">Starred</span>
                    </div>
                    <div className="border-l-2 border-foreground bg-muted/40 px-3 py-2.5">
                      <div className="editorial-eyebrow mb-1 text-[9px]">Stratechery · 2h · 9 min</div>
                      <div className="font-serif text-sm font-semibold leading-snug">
                        The aggregation theory of LLM distribution
                      </div>
                      <div className="mt-1 font-serif text-xs leading-snug text-muted-foreground">
                        A rare full-throated argument for why model providers capture value.
                      </div>
                    </div>
                    <div className="border-b border-border py-2.5">
                      <div className="editorial-eyebrow mb-1 text-[9px]">FT Alphaville · 3h · 7 min</div>
                      <div className="font-serif text-sm font-semibold leading-snug">Japan&apos;s yield curve is telling you something</div>
                    </div>
                    <div className="py-2.5 opacity-55">
                      <div className="editorial-eyebrow mb-1 text-[9px]">Benedict Evans · yesterday</div>
                      <div className="font-serif text-sm leading-snug">The compounding economics of compute</div>
                    </div>
                  </div>
                </div>
                <figcaption className="mt-3 flex items-baseline gap-2">
                  <span className="editorial-eyebrow font-medium text-foreground">Feeds</span>
                  <span className="font-serif text-sm text-muted-foreground">— a three-pane reader that keeps up.</span>
                </figcaption>
              </figure>
            </Reveal>

            {/* Ask mini */}
            <Reveal as="div">
              <figure className="m-0">
                <div className="h-80 overflow-hidden border border-foreground bg-card">
                  <div className="flex items-baseline gap-3 border-b border-border px-5 py-3">
                    <span className="editorial-eyebrow font-medium text-foreground">Ask</span>
                    <span className="font-serif text-sm">AI safety this week</span>
                    <span className="editorial-eyebrow ml-auto">· 4 sources</span>
                  </div>
                  <div className="p-5">
                    <div className="mb-4 flex justify-end">
                      <div className="max-w-[78%] bg-muted px-3 py-2 font-serif text-xs leading-relaxed">
                        Summarize what I&apos;ve read about AI safety this week.
                      </div>
                    </div>
                    <div className="editorial-eyebrow mb-2 font-medium text-foreground text-[9px]">◆ Answer · grounded in 4 sources</div>
                    <div className="font-serif text-xs leading-relaxed">
                      <p className="m-0 mb-2">
                        Across the four pieces you saved, the thread is a <em>shift away from capability benchmarks</em>{" "}
                        toward elicitation-grounded evaluation. <span className="font-mono text-[10px] font-bold">[01]</span>{" "}
                        <span className="font-mono text-[10px] font-bold">[02]</span>
                      </p>
                      <p className="m-0 mb-2">
                        METR proposes a <em>task-time horizon</em> metric.{" "}
                        <span className="font-mono text-[10px] font-bold">[03]</span>
                      </p>
                    </div>
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="editorial-eyebrow mb-1.5 text-[9px]">Sources</div>
                      <div className="font-serif text-xs leading-relaxed text-muted-foreground">
                        <div><span className="font-mono text-[10px] font-bold">[01]</span> METR&apos;s 2025 retrospective</div>
                        <div><span className="font-mono text-[10px] font-bold">[02]</span> AISI: Why capability evals fail</div>
                      </div>
                    </div>
                  </div>
                </div>
                <figcaption className="mt-3 flex items-baseline gap-2">
                  <span className="editorial-eyebrow font-medium text-foreground">Ask</span>
                  <span className="font-serif text-sm text-muted-foreground">— answers with footnotes to your own library.</span>
                </figcaption>
              </figure>
            </Reveal>

            {/* Study mini */}
            <Reveal as="div" delay={90}>
              <figure className="m-0">
                <div className="h-80 overflow-hidden border border-foreground bg-card p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="editorial-eyebrow font-medium text-foreground">Study</span>
                    <span className="editorial-eyebrow">Today&apos;s queue · 12 cards</span>
                    <span className="h-px flex-1 bg-border" />
                    <span className="editorial-eyebrow">4 / 12</span>
                  </div>
                  <div className="mt-5 flex min-h-[200px] flex-col border border-foreground bg-muted/40 p-6">
                    <div className="editorial-eyebrow mb-4 text-[10px]">Prompt · from &ldquo;The Aggregation Theory&rdquo;</div>
                    <div className="editorial-display text-xl font-semibold leading-snug">
                      Which layer of the LLM stack does Thompson now argue captures the aggregation rents?
                    </div>
                    <div className="flex-1" />
                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="border border-foreground px-3 py-1.5 font-serif text-xs">Again</span>
                      <span className="border border-foreground px-3 py-1.5 font-serif text-xs">Hard</span>
                      <span className="bg-foreground px-3 py-1.5 font-serif text-xs text-background">Good</span>
                      <span className="border border-foreground px-3 py-1.5 font-serif text-xs">Easy</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-[3px] flex-1 bg-border">
                      <div className="h-full w-1/3 bg-foreground" />
                    </div>
                    <span className="editorial-eyebrow text-[9px]">Next in 3d</span>
                  </div>
                </div>
                <figcaption className="mt-3 flex items-baseline gap-2">
                  <span className="editorial-eyebrow font-medium text-foreground">Study</span>
                  <span className="font-serif text-sm text-muted-foreground">— flashcards distilled from anything you saved.</span>
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── COMPARISON ─────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl border-b border-foreground px-5 py-16 sm:px-8 sm:py-20">
        <LandingReveal className="mb-9 flex flex-wrap items-baseline gap-3" delay={0}>
          <span className="editorial-eyebrow font-medium text-foreground">§ 03</span>
          <div className="editorial-display text-2xl font-semibold sm:text-[2rem]">
            Why not just use …?
          </div>
          <span className="landing-rule h-px flex-1 bg-border" />
        </LandingReveal>

        {/* Scrollable on small screens so the 5-col table doesn't overflow */}
        <div className="overflow-x-auto">
          <div className="min-w-[640px] border border-foreground">
            {/* header */}
            <div className="grid grid-cols-[200px_repeat(4,1fr)] border-b-2 border-foreground">
              <div className="editorial-eyebrow p-4 font-medium text-foreground">Feature</div>
              <div className="border-l border-border p-4 editorial-eyebrow">Notion</div>
              <div className="border-l border-border p-4 editorial-eyebrow">Readwise</div>
              <div className="border-l border-border p-4 editorial-eyebrow">Obsidian</div>
              <div className="border-l border-border bg-foreground p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-background">
                Second Brain
              </div>
            </div>
            {/* rows */}
            {COMPARE.map((row, i) => (
              <div
                key={row.feature}
                className={"landing-cmp-row grid grid-cols-[200px_repeat(4,1fr)]" + (i < COMPARE.length - 1 ? " border-b border-border" : "")}
              >
                <div className="p-4 font-serif font-semibold">{row.feature}</div>
                <div className="border-l border-border p-4 font-serif text-sm text-muted-foreground">{row.notion}</div>
                <div className="border-l border-border p-4 font-serif text-sm text-muted-foreground">{row.readwise}</div>
                <div className="border-l border-border p-4 font-serif text-sm text-muted-foreground">{row.obsidian}</div>
                <div className="border-l border-border p-4 font-serif font-semibold">{row.sb}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-5 font-serif text-sm italic text-muted-foreground">
          Not a knock on any of them — they&apos;re wonderful tools. Second Brain is what happens when one person tries
          to fold &ldquo;read&rdquo;, &ldquo;keep&rdquo;, and &ldquo;recall&rdquo; into one place.
        </p>
      </section>

      {/* ── CLOSING CTA ────────────────────────────────────────────── */}
      <section className="border-b-4 border-double border-foreground text-center">
        <div className="mx-auto w-full max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="editorial-eyebrow mb-5">— End of front page —</div>
          <Reveal as="div">
            <h2
              className="editorial-display font-extrabold"
              style={{ fontSize: "clamp(2.4rem, 9vw, 5.5rem)", lineHeight: 0.95, letterSpacing: "-0.035em" }}
            >
              Build your
              <br />
              Second Brain.
            </h2>
          </Reveal>
          <p className="mx-auto mt-6 max-w-md font-serif text-lg text-muted-foreground">
            Free. Yours. Under a minute to start. Bring your own API keys or use ours.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/signup"
              className="landing-btn-primary inline-flex h-12 items-center gap-2 rounded-none px-6 text-sm font-semibold text-background"
              style={{ background: "hsl(var(--foreground))" }}
            >
              Start your Second Brain <ArrowRight className="landing-arr h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="font-serif text-base underline underline-offset-4"
            >
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="editorial-display text-lg font-bold">Second Brain</div>
            <div className="editorial-eyebrow mt-1.5">Vol. III · Personal Edition</div>
            <p className="mt-3.5 font-serif text-sm leading-relaxed text-muted-foreground">
              A private home for what you read.
              <br />
              Built by one person. Open source. Yours.
            </p>
          </div>
          <div>
            <div className="editorial-eyebrow mb-2.5 font-medium text-foreground">Product</div>
            <div className="flex flex-col gap-1.5 font-serif text-sm">
              <Link href="/today" className="hover:text-foreground">Today</Link>
              <Link href="/feeds" className="hover:text-foreground">Feeds</Link>
              <Link href="/ask" className="hover:text-foreground">Ask</Link>
              <Link href="/study" className="hover:text-foreground">Study</Link>
              <Link href="/directory" className="hover:text-foreground">Directory</Link>
            </div>
          </div>
          <div>
            <div className="editorial-eyebrow mb-2.5 font-medium text-foreground">Company</div>
            <div className="flex flex-col gap-1.5 font-serif text-sm">
              <Link href="/guide" className="hover:text-foreground">Guide</Link>
              <Link href="/guide" className="hover:text-foreground">Roadmap</Link>
              <Link href="/guide" className="hover:text-foreground">Changelog</Link>
              <a href="https://github.com" className="hover:text-foreground" target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
          </div>
          <div>
            <div className="editorial-eyebrow mb-2.5 font-medium text-foreground">Account</div>
            <div className="flex flex-col gap-1.5 font-serif text-sm">
              <Link href="/login" className="hover:text-foreground">Sign in</Link>
              <Link href="/signup" className="hover:text-foreground">Get started</Link>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-4 sm:flex-row">
          <div className="editorial-eyebrow text-[10px]">Set in Source Serif 4 · Made carefully · © 2026</div>
          <div className="editorial-eyebrow text-[10px]">v0.9.1 · Phase III</div>
        </div>
      </footer>
    </main>
  );
}

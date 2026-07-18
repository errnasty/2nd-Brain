import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CORE_LOOP, GUIDE_SECTIONS, SHORTCUTS, GUIDE_ICON } from "@/data/guide";

export const metadata: Metadata = {
  title: "Guide — Second Brain",
  description:
    "How to use Second Brain: capture, organize, distill, and express. A plain-English tour of every feature.",
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

export default function GuidePage() {
  const GuideIcon = GUIDE_ICON;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        {/* Masthead */}
        <header className="editorial-rule pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="editorial-eyebrow-brand">§ The Guide</div>
            <nav className="flex items-center gap-3 text-xs">
              <Link href="/today" className="text-muted-foreground hover:text-foreground">
                Open the app
              </Link>
              <Link href="/signup" className="font-medium text-foreground hover:underline">
                Get started
              </Link>
            </nav>
          </div>
          <h1
            className="editorial-display mt-3"
            style={{ fontSize: "clamp(2rem, 6vw, 3.25rem)" }}
          >
            Your Second Brain, in plain English.
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            A private home for everything you read, write, and want to remember — with an AI that
            actually knows your stuff. Here&rsquo;s the whole app in a few minutes.
          </p>
        </header>

        {/* Core loop */}
        <section className="mt-10">
          <div className="editorial-eyebrow mb-4">The core idea · one simple loop</div>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CORE_LOOP.map((s) => {
              const Icon = s.icon;
              return (
                <li
                  key={s.step}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border">
                    <Icon className="h-4.5 w-4.5" style={{ color: "hsl(var(--brand))" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{s.step}</span>
                      <span className="font-semibold">{s.label}</span>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.blurb}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Feature sections */}
        <section className="mt-12">
          <div className="editorial-section-row mb-6">
            <span className="editorial-eyebrow">Every feature</span>
            <span className="editorial-section-rule" />
          </div>
          <div className="space-y-4">
            {GUIDE_SECTIONS.map((f) => {
              const Icon = f.icon;
              return (
                <article
                  key={f.id}
                  id={f.id}
                  className="scroll-mt-6 rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border">
                      <Icon className="h-5 w-5" style={{ color: "hsl(var(--brand))" }} />
                    </div>
                    <div className="min-w-0">
                      <div className="editorial-eyebrow">{f.eyebrow}</div>
                      <h2 className="editorial-display text-xl leading-tight">{f.title}</h2>
                    </div>
                    {f.href && (
                      <Link
                        href={f.href}
                        className="ml-auto hidden shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"
                      >
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        What
                      </dt>
                      <dd className="leading-relaxed">{f.what}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        Why
                      </dt>
                      <dd className="leading-relaxed text-muted-foreground">{f.why}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        How
                      </dt>
                      <dd className="leading-relaxed text-muted-foreground">{f.how}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>

        {/* Shortcuts */}
        <section className="mt-12">
          <div className="editorial-section-row mb-4">
            <span className="editorial-eyebrow">Move fast · keyboard shortcuts</span>
            <span className="editorial-section-rule" />
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-sm">{s.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {s.keys.map((k, idx) => (
                    <span key={k} className="flex items-center gap-1.5">
                      {idx > 0 && <span className="text-[10px] text-muted-foreground">/</span>}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer CTA */}
        <footer className="mt-14 flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GuideIcon className="h-4 w-4" />
            That&rsquo;s the whole app. Now go build your Second Brain.
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-medium text-[hsl(var(--brand-foreground))]"
              style={{ background: "hsl(var(--brand))" }}
            >
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

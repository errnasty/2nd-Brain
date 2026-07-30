import type { Metadata } from "next";
import Link from "next/link";
import { Download, ShieldCheck, Smartphone, RefreshCw } from "lucide-react";

export const metadata: Metadata = {
  title: "Get the Android app — Second Brain",
  description:
    "Install Second Brain on Android. A small app that always runs the latest version — no update prompts, ever.",
};

/**
 * Public download page for the Android build.
 *
 * Must stay reachable logged-out — it's the page you send someone who doesn't
 * have the app yet. `/download` is listed in `isAuthRoute`
 * (src/lib/supabase/middleware.ts) for exactly that reason.
 *
 * The APK link is GitHub's `releases/latest/download/<asset>` permalink, which
 * always resolves to the newest release. That's deliberate: this page never
 * needs editing when a new APK ships, and there is no version number here to
 * fall out of date.
 */
const APK_URL = "https://github.com/errnasty/2nd-Brain/releases/latest/download/second-brain.apk";

const STEPS = [
  {
    n: 1,
    title: "Download the file",
    body: "Tap the button above on your Android phone. Chrome will warn you that this type of file can harm your device — that warning appears for every APK, including ones from developers you trust. Choose “Download anyway”.",
  },
  {
    n: 2,
    title: "Allow the install",
    body: "Open the downloaded file. Android will ask whether to allow installs from this source; that permission is per-app, so allowing Chrome here doesn't open anything else up. Grant it, then tap Install.",
  },
  {
    n: 3,
    title: "Sign in once",
    body: "Open the app and sign in as you would on the web. The session persists, so you won't be asked again on this device.",
  },
];

const FACTS = [
  {
    icon: RefreshCw,
    title: "It updates itself",
    body: "The app runs the live site, so every improvement appears the next time you open it. There is nothing to reinstall and no update prompts — a new download is only needed on the rare occasion the app's name or icon changes.",
  },
  {
    icon: Smartphone,
    title: "It's tiny",
    body: "A couple of megabytes. It contains no copy of the app — it renders the real thing, full screen, with no browser bars in the way.",
  },
  {
    icon: ShieldCheck,
    title: "Your login is Chrome's login",
    body: "The app is rendered by Chrome itself rather than a bundled browser, so your session works exactly as it does on the web — and the app has no independent access to it.",
  },
];

export default function DownloadPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        {/* Masthead */}
        <header className="editorial-rule pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="editorial-eyebrow-brand">§ Android</div>
            <nav className="flex items-center gap-3 text-xs">
              <Link href="/guide" className="text-muted-foreground hover:text-foreground">
                The guide
              </Link>
              <Link href="/today" className="font-medium text-foreground hover:underline">
                Open the app
              </Link>
            </nav>
          </div>
          <h1 className="editorial-display mt-3" style={{ fontSize: "clamp(2rem, 6vw, 3.25rem)" }}>
            Second Brain, on your phone.
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            A small Android app that opens straight into your brief — no address bar, no tabs, and
            always the latest version.
          </p>
        </header>

        {/* Download */}
        <section className="mt-10">
          <a
            href={APK_URL}
            className="inline-flex items-center gap-2.5 rounded-xl bg-foreground px-5 py-3 text-[15px] font-medium text-background transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Download for Android
          </a>
          <p className="mt-3 text-xs text-muted-foreground">
            Android 8.0 or newer, with Chrome installed (it is, on virtually every Android phone).
            Not on the Play Store — see the steps below for what Android will ask you.
          </p>
        </section>

        {/* Install steps */}
        <section className="mt-12">
          <div className="editorial-eyebrow mb-4">Installing · about a minute</div>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-muted-foreground">
                  {s.n}
                </span>
                <div>
                  <div className="text-sm font-medium">{s.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* What it is */}
        <section className="mt-12">
          <div className="editorial-eyebrow mb-4">What you&rsquo;re installing</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FACTS.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded-xl border border-border bg-card p-4">
                  <Icon className="h-4 w-4" style={{ color: "hsl(var(--brand))" }} />
                  <div className="mt-2.5 text-sm font-medium">{f.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Offline */}
        <section className="mt-12">
          <div className="editorial-eyebrow mb-4">Offline</div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Pages you&rsquo;ve already opened stay readable without a connection, and the app opens
              rather than showing a browser error. Anything you haven&rsquo;t loaded yet — a fresh
              brief, a new article — needs the network.
            </p>
          </div>
        </section>

        {/* iPhone */}
        <section className="mt-12">
          <div className="editorial-eyebrow mb-4">On iPhone</div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              There&rsquo;s no iOS app, but you get most of the same thing for free: open the site in
              Safari, tap Share, then <span className="text-foreground">Add to Home Screen</span>. It
              gets its own icon and opens full screen without Safari&rsquo;s bars.
            </p>
          </div>
        </section>

        <footer className="mt-16 border-t border-border pt-5 editorial-eyebrow">
          <span>Second Brain · Android</span>
        </footer>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, Brain, Lightbulb } from "lucide-react";
import { DailyBrief } from "@/components/today/daily-brief";
import { requireUser } from "@/lib/auth";
import { getDisplayName } from "@/lib/profile/store";
import { fetchCardStats } from "@/app/(app)/review/actions";
import { fetchDailyDecksDue, type DailyDeckDue } from "@/lib/thinktank/daily";

/** Best-effort first name: chosen display name, profile/metadata name, else
 *  the email local part. */
function firstNameOf(
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
  displayName: string | null,
): string | undefined {
  const meta = user.user_metadata ?? {};
  const full =
    displayName ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  const raw = full || (user.email ? user.email.split("@")[0] : "");
  const first = raw.split(/[\s._-]+/).filter(Boolean)[0];
  if (!first) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default async function TodayPage() {
  const { user } = await requireUser();
  // Independent reads, in parallel; both fail-soft (a profile hiccup or a
  // pending migration must not break Today). The displayName read is usually
  // a free cache hit — the app layout already fetched it this request.
  const [nameResult, statsResult, decksResult] = await Promise.allSettled([
    getDisplayName(user.id),
    fetchCardStats(user.id),
    fetchDailyDecksDue(user.id),
  ]);
  const displayName = nameResult.status === "fulfilled" ? nameResult.value : null;
  const name = firstNameOf(user, displayName);
  let due = 0;
  if (statsResult.status === "fulfilled") {
    ({ due } = statsResult.value);
  } else {
    console.error(
      "TodayPage card stats failed:",
      statsResult.reason instanceof Error ? statsResult.reason.message : statsResult.reason,
    );
  }
  const dailyDecks: DailyDeckDue[] = decksResult.status === "fulfilled" ? decksResult.value : [];
  // ~7s/card is a realistic reveal+grade pace; keeps the promise honest.
  const minutes = Math.max(1, Math.round((due * 7) / 60));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* H1 hidden on mobile — the fixed top app bar already shows the title. */}
        <header className="mb-6 lg:mb-8">
          <h1 className="hidden text-3xl font-semibold tracking-tight lg:block">Daily Brief</h1>
          <p className="text-sm text-muted-foreground lg:mt-1">
            A synthesis of your unread articles from the last 24 hours.
          </p>
        </header>
        {/* Review-due CTA: Today is the landing page; the review queue lives
            buried in the Study hub. Surfacing the due count here converts the
            daily-open habit into a daily-review habit. */}
        {due > 0 && (
          <Link
            href="/study?tab=review"
            prefetch={true}
            className="group mb-6 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-brand/50 hover:bg-accent/50"
          >
            <Brain className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--brand))" }} />
            <span className="flex-1 text-sm">
              <span className="font-semibold">{due} card{due === 1 ? "" : "s"} due</span>
              <span className="text-muted-foreground"> · about {minutes} min — keep the streak alive</span>
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: "hsl(var(--brand))" }}>
              Start review
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}
        {/* Daily-paced ThinkTank decks with fresh cards unlocked — same
            daily-habit surface as the review CTA. */}
        {dailyDecks.length > 0 && (
          <Link
            href={`/thinktank/${dailyDecks[0].id}`}
            prefetch={true}
            className="group mb-6 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-brand/50 hover:bg-accent/50"
          >
            <Lightbulb className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--brand))" }} />
            <span className="flex-1 text-sm">
              <span className="font-semibold">
                {dailyDecks[0].remaining} new idea card{dailyDecks[0].remaining === 1 ? "" : "s"}
              </span>
              <span className="text-muted-foreground">
                {" "}· “{dailyDecks[0].title}”
                {dailyDecks.length > 1 ? ` and ${dailyDecks.length - 1} more deck${dailyDecks.length > 2 ? "s" : ""}` : ""}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: "hsl(var(--brand))" }}>
              Keep learning
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}
        <DailyBrief name={name} />
      </div>
    </div>
  );
}

import { DailyBrief, type InitialBrief } from "@/components/today/daily-brief";
import { TodayGlance } from "@/components/today/today-glance";
import { requireUser } from "@/lib/auth";
import { getDisplayName } from "@/lib/profile/store";
import { fetchTodayGlance, type TodayGlance as GlanceData } from "@/lib/today/glance";
import { loadUserBrief } from "@/lib/brief-cache";

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

const EMPTY_GLANCE: GlanceData = {
  dueCards: 0,
  reviewMinutes: 1,
  dailyDecks: [],
  deckCards: 0,
  tasksDueToday: 0,
  streakDays: 0,
  dailyXp: 0,
  dailyGoal: 100,
};

export default async function TodayPage() {
  const { user } = await requireUser();
  // Independent reads, in parallel; each fail-soft (a profile hiccup or a
  // pending migration must not break Today). The displayName read is usually
  // a free cache hit — the app layout already fetched it this request.
  const [nameResult, glanceResult, briefResult] = await Promise.allSettled([
    getDisplayName(user.id),
    fetchTodayGlance(user.id),
    loadUserBrief(user.id),
  ]);
  const displayName = nameResult.status === "fulfilled" ? nameResult.value : null;
  const name = firstNameOf(user, displayName);
  const glance = glanceResult.status === "fulfilled" ? glanceResult.value : EMPTY_GLANCE;

  // Hand the stored brief to the client so it paints instantly — no fetch, no
  // flash — and generates once server-side, not per device. Null when the
  // user has never generated one (the client streams a fresh brief on mount).
  const stored = briefResult.status === "fulfilled" ? briefResult.value : null;
  const initialBrief: InitialBrief | null = stored
    ? {
        content: stored.content,
        sources: stored.sourceMap,
        usage: stored.usage,
        generatedAt: stored.generatedAt.toISOString(),
        fingerprint: stored.fingerprint,
      }
    : null;

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
        {/* One consolidated daily-rhythm strip (review, deck cards, tasks,
            streak) replacing the old stacked banner cards. */}
        <TodayGlance glance={glance} firstDeckId={glance.dailyDecks[0]?.id ?? null} />
        <DailyBrief name={name} initialBrief={initialBrief} />
      </div>
    </div>
  );
}

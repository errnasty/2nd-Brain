import { DailyBrief } from "@/components/today/daily-brief";
import { requireUser } from "@/lib/auth";

/** Best-effort first name: profile/metadata name, else the email local part. */
function firstNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string | undefined {
  const meta = user.user_metadata ?? {};
  const full = (typeof meta.full_name === "string" && meta.full_name) || (typeof meta.name === "string" && meta.name) || "";
  const raw = full || (user.email ? user.email.split("@")[0] : "");
  const first = raw.split(/[\s._-]+/).filter(Boolean)[0];
  if (!first) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default async function TodayPage() {
  const { user } = await requireUser();
  const name = firstNameOf(user);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* H1 hidden on mobile — the fixed top app bar already shows the title. */}
        <header className="mb-6 md:mb-8">
          <h1 className="hidden text-3xl font-semibold tracking-tight md:block">Daily Brief</h1>
          <p className="text-sm text-muted-foreground md:mt-1">
            A synthesis of your unread articles from the last 24 hours.
          </p>
        </header>
        <DailyBrief name={name} />
      </div>
    </div>
  );
}

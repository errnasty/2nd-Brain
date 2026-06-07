import { DailyBrief } from "@/components/today/daily-brief";
import { requireUser } from "@/lib/auth";

export default async function TodayPage() {
  await requireUser();
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
        <DailyBrief />
      </div>
    </div>
  );
}

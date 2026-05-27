import { DailyBrief } from "@/components/today/daily-brief";
import { requireUser } from "@/lib/auth";

export default async function TodayPage() {
  await requireUser();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Daily Brief</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A synthesis of your unread articles from the last 24 hours.
          </p>
        </header>
        <DailyBrief />
      </div>
    </div>
  );
}

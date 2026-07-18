import { checkAiBudget, dailyTokenBudget } from "@/lib/ai/budget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Server component: today's AI token spend against AI_DAILY_TOKEN_BUDGET.
 * Rendered only when a budget is configured (without one, usage isn't
 * recorded, so there'd be nothing truthful to show).
 */
export async function AiUsageCard({ userId }: { userId: string }) {
  const budget = dailyTokenBudget();
  if (!budget) return null;
  // Fail soft: a usage-read failure must not take down the whole Settings page
  // (this card is awaited inline in it) — just hide the card.
  let used: number;
  try {
    ({ used } = await checkAiBudget(userId));
  } catch (err) {
    console.error("AiUsageCard: checkAiBudget failed:", err instanceof Error ? err.message : err);
    return null;
  }
  const pct = Math.min(100, Math.round((used / budget) * 100));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI usage today</CardTitle>
        <CardDescription>
          Tokens spent across Ask, the Daily Brief, document Q&amp;A, and rabbitholes. Resets at
          midnight UTC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-1.5 flex items-baseline justify-between font-mono text-xs">
          <span>
            {used.toLocaleString()} / {budget.toLocaleString()} tokens
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-foreground"}
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

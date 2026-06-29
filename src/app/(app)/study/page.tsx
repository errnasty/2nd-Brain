import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { directoryFolders, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fetchStudyStats, fetchCalendar, type StudyStats, type CalendarEntry } from "./actions";
import { fetchTasks, type TaskRow } from "../tasks/actions";
import { fetchDueCards, fetchCardStats, type DueCard, type StudyScope } from "../review/actions";
import { fetchGameState, type GameState } from "@/lib/gamify/state";
import { StudyShell, type StudyTab } from "@/components/study/study-shell";

export const dynamic = "force-dynamic";

type Search = Promise<{ tab?: string; folder?: string; item?: string }>;

const TABS = ["overview", "tasks", "review", "calendar"];

export default async function StudyPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tab = (TABS.includes(sp.tab ?? "") ? sp.tab : "overview") as StudyTab;
  const { user } = await requireUser();

  // Optional review scope: "study this folder/note". Review uses the scoped due
  // set; the rest of the hub (stats/tasks/calendar) stays library-wide.
  const scope: StudyScope = { folderId: sp.folder ?? null, itemId: sp.item ?? null };
  const isScoped = !!(scope.folderId || scope.itemId);
  let scopeLabel: string | null = null;
  if (scope.folderId) {
    const [f] = await db
      .select({ name: directoryFolders.name })
      .from(directoryFolders)
      .where(and(eq(directoryFolders.id, scope.folderId), eq(directoryFolders.userId, user.id)))
      .limit(1);
    scopeLabel = f?.name ?? null;
  } else if (scope.itemId) {
    const [i] = await db
      .select({ title: directoryItems.title })
      .from(directoryItems)
      .where(and(eq(directoryItems.id, scope.itemId), eq(directoryItems.userId, user.id)))
      .limit(1);
    scopeLabel = i?.title ?? null;
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  let stats: StudyStats = {
    itemsWeek: 0, notesWeek: 0, cardsReviewedWeek: 0, dueToday: 0, totalCards: 0, streak: 0,
    dueTasks: 0, dueSubjects: [], itemsHistory: [], reviewsHistory: [], retentionBySubject: [],
  };
  let tasks: TaskRow[] = [];
  let dueCards: DueCard[] = [];
  let totalCards = 0;
  let dueCardsCount = 0;
  let calendar: CalendarEntry[] = [];
  let game: GameState | null = null;

  // allSettled (not Promise.all): one failing panel query must not blank the
  // whole Study hub. Each panel falls back to its own empty default.
  const [statsR, tasksR, dueR, cardStatsR, calR, gameR] = await Promise.allSettled([
    fetchStudyStats(user.id),
    fetchTasks(user.id),
    fetchDueCards(user.id, 50, isScoped ? scope : undefined),
    fetchCardStats(user.id, isScoped ? scope : undefined),
    fetchCalendar(user.id, from.toISOString(), to.toISOString()),
    fetchGameState(user.id),
  ]);
  if (statsR.status === "fulfilled") stats = statsR.value;
  if (tasksR.status === "fulfilled") tasks = tasksR.value;
  if (dueR.status === "fulfilled") dueCards = dueR.value;
  if (cardStatsR.status === "fulfilled") {
    totalCards = cardStatsR.value.total;
    dueCardsCount = cardStatsR.value.due;
  }
  if (calR.status === "fulfilled") calendar = calR.value;
  if (gameR.status === "fulfilled") game = gameR.value;
  for (const [name, r] of [
    ["stats", statsR], ["tasks", tasksR], ["due", dueR], ["cardStats", cardStatsR], ["calendar", calR], ["game", gameR],
  ] as const) {
    if (r.status === "rejected") {
      console.error(`StudyPage ${name} fetch failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }

  return (
    <StudyShell
      defaultTab={tab}
      stats={stats}
      tasks={tasks}
      dueCards={dueCards}
      totalCards={totalCards}
      dueCount={dueCardsCount}
      calendar={calendar}
      game={game}
      reviewScopeLabel={isScoped ? scopeLabel : null}
    />
  );
}

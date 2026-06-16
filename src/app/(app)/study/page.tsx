import { requireUser } from "@/lib/auth";
import { fetchStudyStats, fetchCalendar, type StudyStats, type CalendarEntry } from "./actions";
import { fetchTasks, type TaskRow } from "../tasks/actions";
import { fetchDueCards, fetchCardStats, type DueCard } from "../review/actions";
import { StudyShell, type StudyTab } from "@/components/study/study-shell";

export const dynamic = "force-dynamic";

type Search = Promise<{ tab?: string }>;

const TABS = ["overview", "tasks", "review", "calendar"];

export default async function StudyPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tab = (TABS.includes(sp.tab ?? "") ? sp.tab : "overview") as StudyTab;
  const { user } = await requireUser();

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  let stats: StudyStats = {
    itemsWeek: 0, notesWeek: 0, cardsReviewedWeek: 0, dueToday: 0, totalCards: 0, streak: 0,
  };
  let tasks: TaskRow[] = [];
  let dueCards: DueCard[] = [];
  let totalCards = 0;
  let dueCardsCount = 0;
  let calendar: CalendarEntry[] = [];

  // allSettled (not Promise.all): one failing panel query must not blank the
  // whole Study hub. Each panel falls back to its own empty default.
  const [statsR, tasksR, dueR, cardStatsR, calR] = await Promise.allSettled([
    fetchStudyStats(user.id),
    fetchTasks(user.id),
    fetchDueCards(user.id),
    fetchCardStats(user.id),
    fetchCalendar(user.id, from.toISOString(), to.toISOString()),
  ]);
  if (statsR.status === "fulfilled") stats = statsR.value;
  if (tasksR.status === "fulfilled") tasks = tasksR.value;
  if (dueR.status === "fulfilled") dueCards = dueR.value;
  if (cardStatsR.status === "fulfilled") {
    totalCards = cardStatsR.value.total;
    dueCardsCount = cardStatsR.value.due;
  }
  if (calR.status === "fulfilled") calendar = calR.value;
  for (const [name, r] of [
    ["stats", statsR], ["tasks", tasksR], ["due", dueR], ["cardStats", cardStatsR], ["calendar", calR],
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
    />
  );
}

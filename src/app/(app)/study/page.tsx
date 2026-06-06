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
  let calendar: CalendarEntry[] = [];

  try {
    [stats, tasks, dueCards, { total: totalCards }, calendar] = await Promise.all([
      fetchStudyStats(user.id),
      fetchTasks(user.id),
      fetchDueCards(user.id),
      fetchCardStats(user.id),
      fetchCalendar(user.id, from.toISOString(), to.toISOString()),
    ]);
  } catch (err) {
    console.error("StudyPage fetch failed:", err instanceof Error ? err.message : err);
  }

  return (
    <StudyShell
      defaultTab={tab}
      stats={stats}
      tasks={tasks}
      dueCards={dueCards}
      totalCards={totalCards}
      calendar={calendar}
    />
  );
}

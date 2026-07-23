import { requireUser } from "@/lib/auth";
import { AskShell } from "@/components/ask/ask-shell";
import { listThreads, loadThread, type ThreadMessage } from "@/app/(app)/ask/thread-actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ thread?: string; prefill?: string; attach?: string }>;

export default async function AskPage({ searchParams }: { searchParams: Search }) {
  await requireUser();
  const sp = await searchParams;

  // Thread list for the sidebar + the active thread's messages for instant
  // paint (deep-linkable via ?thread=<id>). Both fail-soft inside the actions.
  const [threads, active] = await Promise.all([
    listThreads(),
    sp.thread ? loadThread(sp.thread) : Promise.resolve(null),
  ]);
  const initialMessages: ThreadMessage[] = active?.messages ?? [];

  return (
    <div className="h-full overflow-hidden">
      <AskShell
        initialThreads={threads}
        activeThreadId={active?.id ?? null}
        initialMessages={initialMessages}
        initialPrefill={sp.prefill}
        initialAttachId={sp.attach}
      />
    </div>
  );
}

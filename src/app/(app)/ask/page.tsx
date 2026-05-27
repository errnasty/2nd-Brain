import { requireUser } from "@/lib/auth";
import { AskShell } from "@/components/ask/ask-shell";

export default async function AskPage() {
  await requireUser();
  return (
    <div className="h-full overflow-hidden">
      <AskShell />
    </div>
  );
}

"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateDisplayNameAction } from "@/lib/profile/actions";
import { updateUserSettingsAction } from "@/lib/settings/actions";

/** Name + learning interests picked at onboarding — revisitable here.
 *  Interests seed ThinkTank's topic suggestions. */
export function ProfileSettings({
  initialName,
  initialInterests,
}: {
  initialName: string | null;
  initialInterests: string[];
}) {
  const [name, setName] = useState(initialName ?? "");
  const [savedName, setSavedName] = useState(initialName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [interests, setInterests] = useState(initialInterests);
  const [draft, setDraft] = useState("");

  async function saveName() {
    setSavingName(true);
    try {
      const r = await updateDisplayNameAction(name);
      setSavedName(r.displayName ?? "");
      toast.success("Name saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your name");
    } finally {
      setSavingName(false);
    }
  }

  // Shallow-merge caveat upstream: always send the whole interests array.
  function saveInterests(next: string[]) {
    setInterests(next);
    updateUserSettingsAction({ interests: next }).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't save your interests"),
    );
  }

  function addInterest() {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    if (!interests.includes(t)) saveInterests([...interests, t]);
  }

  return (
    <section className="pt-4">
      <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Profile
      </h2>

      <div className="flex items-start justify-between gap-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Your name</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Personalizes the daily brief and the sidebar. Leave empty to use your email.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() !== savedName && saveName()}
            placeholder="Your name"
            maxLength={60}
            className="h-9 w-44 text-sm"
          />
          <LoadingButton
            size="sm"
            variant="outline"
            loading={savingName}
            disabled={name.trim() === savedName}
            onClick={saveName}
          >
            Save
          </LoadingButton>
        </div>
      </div>

      <div className="py-4">
        <div className="text-sm font-medium">Learning interests</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Topics you want to explore — ThinkTank uses them to suggest decks.
        </div>
        <div className={cn("flex flex-wrap gap-1.5", interests.length > 0 && "mt-3")}>
          {interests.map((topic) => (
            <button
              key={topic}
              onClick={() => saveInterests(interests.filter((t) => t !== topic))}
              className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Remove ${topic}`}
            >
              {topic}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addInterest();
              }
            }}
            placeholder="Add a topic…"
            className="h-9 max-w-xs text-sm"
          />
          <Button size="sm" variant="outline" onClick={addInterest} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}

import { toast } from "sonner";
import type { AwardResult } from "@/lib/gamify/award";

/**
 * Client-side celebration for an XP award. Shows a toast for milestones
 * (level-up, evolution, achievement) and fires confetti — plain XP gains stay
 * quiet so it never spams. Safe to call with undefined/no-op results.
 */
export function celebrate(r: AwardResult | undefined | null): void {
  if (!r || r.awarded <= 0) return;
  let party = false;

  if (r.evolvedTo && r.skill) {
    toast.success(`${r.skill.emoji ?? "✨"} ${r.skill.name} evolved → ${r.evolvedTo}!`);
    party = true;
  } else if (r.skillLeveledUp && r.skill) {
    toast(`${r.skill.emoji ?? "✨"} ${r.skill.name} reached Lv ${r.skill.level}`);
    party = true;
  }
  if (r.playerLeveledUp) {
    toast.success(`Level up! You're now level ${r.playerLevel} 🎉`);
    party = true;
  }
  for (const a of r.newAchievements ?? []) {
    toast.success(`${a.emoji} Achievement: ${a.name}`);
    party = true;
  }

  if (party && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gamify-celebrate"));
  }
}

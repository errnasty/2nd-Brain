import { toast } from "sonner";
import type { AwardResult } from "@/lib/gamify/award";

/** Payload the global <Confetti /> listens for. */
export type CelebrateDetail = { colors?: string[]; intensity?: number };

function party(detail: CelebrateDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CelebrateDetail>("gamify-celebrate", { detail }));
}

/**
 * Client-side celebration for an XP award. Shows a toast for milestones
 * (level-up, rank promotion, evolution, achievement) and fires confetti tinted
 * to the milestone's own colors — plain XP gains stay quiet so it never spams.
 * Safe to call with undefined/no-op results.
 */
export function celebrate(r: AwardResult | undefined | null): void {
  if (!r || r.awarded <= 0) return;
  let fire = false;
  // Biggest milestone wins the confetti palette: rank > evolution > default.
  let colors: string[] | undefined;
  let intensity = 1;

  if (r.evolvedTo && r.skill) {
    toast.success(`${r.skill.emoji ?? "✨"} ${r.skill.name} evolved → ${r.evolvedTo}!`, {
      description: "A new tier — its colors just changed in Study.",
    });
    if (r.evolvedColors) colors = [r.evolvedColors.from, r.evolvedColors.to, "#ffffff"];
    intensity = 1.5;
    fire = true;
  } else if (r.skillLeveledUp && r.skill) {
    toast(`${r.skill.emoji ?? "✨"} ${r.skill.name} reached Lv ${r.skill.level}`);
    fire = true;
  }

  if (r.rankUpTo) {
    toast.success(`New rank: ${r.rankUpTo} — level ${r.playerLevel} 🎉`);
    if (r.rankColors) colors = [r.rankColors.from, r.rankColors.to, "#ffffff"];
    intensity = 2;
    fire = true;
  } else if (r.playerLeveledUp) {
    toast.success(`Level up! You're now level ${r.playerLevel} 🎉`);
    fire = true;
  }

  if (r.goalBonus && r.goalBonus > 0) {
    toast.success(`Daily goal cleared — +${r.goalBonus} bonus XP 🎯`);
    fire = true;
  }

  for (const a of r.newAchievements ?? []) {
    toast.success(`${a.emoji} Achievement: ${a.name}`);
    fire = true;
  }

  if (fire) party({ colors, intensity });
}

/**
 * Lighter feedback for a combo step during review — a floating "+XP" cue with
 * no toast and no confetti, so a long session feels alive without nagging.
 */
export function comboCue(r: AwardResult | undefined | null): void {
  if (typeof window === "undefined" || !r || r.awarded <= 0) return;
  window.dispatchEvent(
    new CustomEvent("gamify-xp", {
      detail: { amount: r.awarded, momentum: r.momentum ?? 0 },
    }),
  );
}

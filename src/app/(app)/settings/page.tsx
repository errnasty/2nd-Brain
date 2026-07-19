import { requireUser } from "@/lib/auth";
import { SettingsForm } from "@/components/settings/settings-form";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { getDisplayName } from "@/lib/profile/store";
import { StudyGenerationSettings } from "@/components/settings/study-generation-settings";
import { DesktopSettings } from "@/components/settings/desktop-settings";
import { OpenInDesktop } from "@/components/settings/open-in-desktop";
import { SettingsShortcuts } from "@/components/shell/keyboard-shortcuts";
import { ReplayTutorial } from "@/components/settings/replay-tutorial";
import { DangerZone } from "@/components/settings/danger-zone";
import { SignOut } from "@/components/settings/sign-out";
import { AiUsageCard } from "@/components/settings/ai-usage-card";
import { ChangePassword } from "@/components/settings/change-password";
import { getUserSettings } from "@/lib/settings/store";
import type { UserSettingsData } from "@/lib/db/schema";

export default async function SettingsPage() {
  const { user } = await requireUser();
  const isDesktop = process.env.APP_RUNTIME === "desktop";
  // Parallel + fail soft: a read failure (transient DB issue, pending
  // migration) must not take down Settings — render defaults instead. Usually
  // both are free cache hits from the app layout's reads this request.
  let settings: UserSettingsData = {};
  let displayName: string | null = null;
  const [settingsResult, nameResult] = await Promise.allSettled([
    getUserSettings(user.id),
    getDisplayName(user.id),
  ]);
  if (settingsResult.status === "fulfilled") settings = settingsResult.value;
  else console.error("SettingsPage: getUserSettings failed:", settingsResult.reason);
  if (nameResult.status === "fulfilled") displayName = nameResult.value;
  else console.error("SettingsPage: getDisplayName failed:", nameResult.reason);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <header className="editorial-rule mb-8 pb-4">
          <div className="editorial-eyebrow mb-2">Account · Preferences</div>
          <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}>
            Settings
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{user.email}</p>
        </header>
        {isDesktop ? (
          <div className="mb-4">
            <DesktopSettings />
          </div>
        ) : (
          <OpenInDesktop />
        )}
        <ProfileSettings initialName={displayName} initialInterests={settings.interests ?? []} />
        <SettingsForm />
        <StudyGenerationSettings
          initial={{
            flashcardDifficulty: settings.flashcardDifficulty,
            flashcardCount: settings.flashcardCount,
            quizDifficulty: settings.quizDifficulty,
            quizCount: settings.quizCount,
          }}
        />
        <div className="mt-8 space-y-3">
          <AiUsageCard userId={user.id} />
          <SettingsShortcuts />
          <ReplayTutorial />
        </div>
        {!isDesktop && (
          <div className="mt-8 space-y-3">
            <ChangePassword />
            <SignOut />
            <DangerZone />
          </div>
        )}
        {isDesktop && (
          <div className="mt-8 space-y-3">
            <SignOut />
          </div>
        )}
      </div>
    </div>
  );
}

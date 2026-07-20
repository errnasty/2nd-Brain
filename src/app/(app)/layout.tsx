import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { getDisplayName } from "@/lib/profile/store";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { QuickCapture } from "@/components/shell/quick-capture";
import { Confetti } from "@/components/shell/confetti";
import { LazyShellExtras } from "@/components/shell/lazy-extras";
import { unseenChangelog } from "@/data/changelog";
import { GlobalShortcuts } from "@/components/shell/keyboard-shortcuts";
import { SyncConflictBanner } from "@/components/shell/sync-conflict-banner";
import { PageTransition } from "@/components/shell/page-transition";
import { RouteProgress } from "@/components/shell/route-progress";
import { SettingsEffects } from "@/components/settings-effects";
import { AppDialogProvider } from "@/components/ui/app-dialogs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireUser() handles the desktop branch (getSession, no network) so the
  // app loads instantly/offline; on web it verifies via getUser(). Cached, so
  // it shares the single auth round-trip with the pages below.
  const { user } = await requireUser();

  // The "What's New" watermark + onboarding state + interests (one settings
  // read) and the masthead display name — independent, so fetched in parallel.
  // Both fail soft: a read hiccup must never block the app shell. Defaulting
  // onboardingDone true on error keeps a hiccup from re-showing the tour.
  let lastSeenChangelog: string | null = null;
  let onboardingDone = true;
  let interests: string[] = [];
  let displayName: string | null = null;
  const [settingsResult, nameResult] = await Promise.allSettled([
    getUserSettings(user.id),
    getDisplayName(user.id),
  ]);
  if (settingsResult.status === "fulfilled") {
    lastSeenChangelog = settingsResult.value.lastSeenChangelog ?? null;
    onboardingDone = settingsResult.value.onboardingDone ?? false;
    interests = settingsResult.value.interests ?? [];
  }
  if (nameResult.status === "fulfilled") displayName = nameResult.value;

  return (
    <AppDialogProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        {/* Re-applies prefs from the signed-in account's scoped keys (the root
            layout's instance runs before the user is known). */}
        <SettingsEffects userId={user.id} />
        <Sidebar userEmail={user.email ?? ""} displayName={displayName} />
        {/* On mobile, clear the fixed top app bar and bottom tab bar (+ safe
            areas). Desktop has neither, so the padding collapses at md+. */}
        <main className="min-w-0 flex-1 overflow-hidden pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pt-0 lg:pb-0">
          <SyncConflictBanner />
          <PageTransition>{children}</PageTransition>
        </main>
        <MobileNav />
        <RouteProgress />
        <CommandPalette />
        <QuickCapture />
        <Confetti />
        <LazyShellExtras
          needsOnboarding={!onboardingDone}
          hasUnseenChangelog={unseenChangelog(lastSeenChangelog).length > 0}
          lastSeenChangelog={lastSeenChangelog}
          onboardingDone={onboardingDone}
          displayName={displayName}
          interests={interests}
        />
        <GlobalShortcuts />
      </div>
    </AppDialogProvider>
  );
}

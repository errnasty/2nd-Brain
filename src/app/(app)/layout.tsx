import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { getDisplayName } from "@/lib/profile/store";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { QuickCapture } from "@/components/shell/quick-capture";
import { Confetti } from "@/components/shell/confetti";
import { Onboarding } from "@/components/shell/onboarding";
import { WhatsNew } from "@/components/shell/whats-new";
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

  // The "What's New" watermark + onboarding state + interests, from one
  // settings read. Fail soft — a settings-read hiccup must never block the
  // whole app shell from rendering.
  let lastSeenChangelog: string | null = null;
  // Default true on error so a read hiccup can't re-show the tour to a veteran.
  let onboardingDone = true;
  let interests: string[] = [];
  try {
    const settings = await getUserSettings(user.id);
    lastSeenChangelog = settings.lastSeenChangelog ?? null;
    onboardingDone = settings.onboardingDone ?? false;
    interests = settings.interests ?? [];
  } catch {
    // ignore — treat as "nothing seen yet"; the modal simply may re-show once.
  }

  // Chosen display name for the sidebar masthead + onboarding prefill.
  let displayName: string | null = null;
  try {
    displayName = await getDisplayName(user.id);
  } catch {
    // fail soft — fall back to email-only masthead
  }

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
        <Onboarding initialDone={onboardingDone} initialName={displayName} initialInterests={interests} />
        <WhatsNew lastSeen={lastSeenChangelog} onboardingDone={onboardingDone} />
        <GlobalShortcuts />
      </div>
    </AppDialogProvider>
  );
}

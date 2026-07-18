import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
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
import { AppDialogProvider } from "@/components/ui/app-dialogs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireUser() handles the desktop branch (getSession, no network) so the
  // app loads instantly/offline; on web it verifies via getUser(). Cached, so
  // it shares the single auth round-trip with the pages below.
  const { user } = await requireUser();

  // The "What's New" watermark. Fail soft — a settings-read hiccup must never
  // block the whole app shell from rendering.
  let lastSeenChangelog: string | null = null;
  try {
    lastSeenChangelog = (await getUserSettings(user.id)).lastSeenChangelog ?? null;
  } catch {
    // ignore — treat as "nothing seen yet"; the modal simply may re-show once.
  }

  return (
    <AppDialogProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        <Sidebar userEmail={user.email ?? ""} />
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
        <Onboarding />
        <WhatsNew lastSeen={lastSeenChangelog} />
        <GlobalShortcuts />
      </div>
    </AppDialogProvider>
  );
}

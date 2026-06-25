import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { QuickCapture } from "@/components/shell/quick-capture";
import { GlobalShortcuts } from "@/components/shell/keyboard-shortcuts";
import { SyncConflictBanner } from "@/components/shell/sync-conflict-banner";
import { AppDialogProvider } from "@/components/ui/app-dialogs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireUser() handles the desktop branch (getSession, no network) so the
  // app loads instantly/offline; on web it verifies via getUser(). Cached, so
  // it shares the single auth round-trip with the pages below.
  const { user } = await requireUser();

  return (
    <AppDialogProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        <Sidebar userEmail={user.email ?? ""} />
        {/* On mobile, clear the fixed top app bar and bottom tab bar (+ safe
            areas). Desktop has neither, so the padding collapses at md+. */}
        <main className="flex-1 overflow-hidden pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
          <SyncConflictBanner />
          {children}
        </main>
        <MobileNav />
        <CommandPalette />
        <QuickCapture />
        <GlobalShortcuts />
      </div>
    </AppDialogProvider>
  );
}

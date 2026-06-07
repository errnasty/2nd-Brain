import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { GlobalShortcuts } from "@/components/shell/keyboard-shortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <Sidebar userEmail={user.email ?? ""} />
      {/* On mobile, clear the fixed top app bar and bottom tab bar (+ safe
          areas). Desktop has neither, so the padding collapses at md+. */}
      <main className="flex-1 overflow-hidden pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        {children}
      </main>
      <MobileNav />
      <CommandPalette />
      <GlobalShortcuts />
    </div>
  );
}

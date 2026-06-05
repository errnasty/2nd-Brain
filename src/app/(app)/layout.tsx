import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { CommandPalette } from "@/components/shell/command-palette";

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
      {/* pb-14 on mobile keeps content clear of the fixed bottom tab bar */}
      <main className="flex-1 overflow-hidden pb-14 md:pb-0">{children}</main>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

/**
 * Sign out of the current session. Clears the local Supabase session and the
 * IndexedDB offline mirror, then redirects to the login page. On desktop the
 * session is local, so a refresh after sign-out returns the user to the
 * landing/login flow.
 */
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      const [{ createSupabaseBrowserClient }, { clearOfflineMirror }] = await Promise.all([
        import("@/lib/supabase/client"),
        import("@/lib/offline/db"),
      ]);
      await clearOfflineMirror();
      // Forget which account's scoped prefs are active (the prefs themselves
      // stay, so signing back in restores this account's look instantly).
      const { clearActiveUser } = await import("@/lib/settings");
      clearActiveUser();
      await createSupabaseBrowserClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(`Couldn't sign out: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Session</CardTitle>
        <CardDescription>
          Sign out of Second Brain on this device. Your data stays safely on the server — sign back in
          anytime to pick up where you left off.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={handleSignOut} disabled={busy}>
          <LogOut className="h-4 w-4" />
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </CardContent>
    </Card>
  );
}

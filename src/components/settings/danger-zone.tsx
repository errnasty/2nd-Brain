"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { deleteAccountAction } from "@/app/(app)/settings/actions";

/**
 * Irreversible account deletion. Two-step: an explicit reveal, then a
 * type-DELETE confirmation (also re-checked server-side by the action).
 */
export function DangerZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (confirmation !== "DELETE") return;
    setDeleting(true);
    try {
      const result = await deleteAccountAction(confirmation);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Best-effort local cleanup; the server has already destroyed the
      // account, so failures here must not block the redirect.
      try {
        const [{ createSupabaseBrowserClient }, { clearOfflineMirror }] = await Promise.all([
          import("@/lib/supabase/client"),
          import("@/lib/offline/db"),
        ]);
        await clearOfflineMirror();
        const { clearActiveUser } = await import("@/lib/settings");
        clearActiveUser();
        await createSupabaseBrowserClient().auth.signOut();
      } catch {
        // Session is already invalid server-side.
      }
      router.replace("/login");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Permanently delete your account and everything in it — feeds, articles, documents,
          notes, flashcards, tasks, rabbitholes, and progress. This cannot be undone. You can
          export your data first from the Directory&apos;s export menu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!open ? (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={confirmation !== "DELETE" || deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting…" : "Permanently delete my account"}
              </Button>
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => {
                  setOpen(false);
                  setConfirmation("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/shell/brand-mark";
import { toast } from "sonner";
import { inviteSignupAction } from "./actions";

function SignupFormInner({ requiresInvite }: { requiresInvite: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords don't match.";
    if (requiresInvite && !inviteCode.trim()) return "An invite code is required.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      // Loaded at submit time: supabase-js + dexie are ~half this page's JS
      // and are needed only once the form is actually posted.
      const [{ createSupabaseBrowserClient }, { clearOfflineMirror }] = await Promise.all([
        import("@/lib/supabase/client"),
        import("@/lib/offline/db"),
      ]);
      const supabase = createSupabaseBrowserClient();

      if (requiresInvite) {
        // Server-enforced: the action checks the code and creates the account
        // (pre-confirmed) with the service role, then we sign in normally.
        const result = await inviteSignupAction(email, password, inviteCode);
        if (!result.ok) throw new Error(result.error);
        const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await clearOfflineMirror(); // fresh account — no stale offline mirror
        if (signIn.user) {
          const { setActiveUser } = await import("@/lib/settings");
          setActiveUser(signIn.user.id); // prefs start scoped to the new account
        }
        router.replace("/");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // With email confirmation disabled, signUp returns an active session and
      // we can go straight in. If confirmation is enabled, there's no session
      // yet — tell the user to check their email.
      if (data.session) {
        await clearOfflineMirror(); // fresh account — no stale offline mirror
        if (data.user) {
          const { setActiveUser } = await import("@/lib/settings");
          setActiveUser(data.user.id); // prefs start scoped to the new account
        }
        router.replace("/");
        router.refresh();
      } else {
        toast.success("Account created. Check your email to confirm, then sign in.");
        router.replace("/login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <div className="editorial-eyebrow justify-center">Vol. III · Personal Edition</div>
          <div className="mt-1.5 flex items-center justify-center gap-2.5">
            <BrandMark className="h-6 w-[29px] text-foreground" />
            <div className="editorial-display text-2xl font-semibold">Second Brain</div>
          </div>
        </div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="editorial-display text-2xl">Create account</CardTitle>
          <CardDescription className="italic">
            {requiresInvite
              ? "This server is invite-only. Enter your invite code to join."
              : "Start building your Second Brain."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {requiresInvite && (
              <div className="space-y-2">
                <Label htmlFor="invite">Invite code</Label>
                <Input
                  id="invite"
                  type="text"
                  required
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Your invite code"
                />
              </div>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating…" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

export function SignupForm({ requiresInvite }: { requiresInvite: boolean }) {
  return (
    <Suspense>
      <SignupFormInner requiresInvite={requiresInvite} />
    </Suspense>
  );
}

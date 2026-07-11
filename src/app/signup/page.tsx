"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords don't match.";
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // With email confirmation disabled, signUp returns an active session and
      // we can go straight in. If confirmation is enabled, there's no session
      // yet — tell the user to check their email.
      if (data.session) {
        await clearOfflineMirror(); // fresh account — no stale offline mirror
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
          <div className="editorial-display mt-1 text-2xl font-semibold">Second Brain</div>
        </div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="editorial-display text-2xl">Create account</CardTitle>
          <CardDescription className="italic">Start building your Second Brain.</CardDescription>
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

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

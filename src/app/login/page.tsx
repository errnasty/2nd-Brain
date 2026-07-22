"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/shell/brand-mark";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (password.length < 1) return "Enter your password.";
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
      // and are needed only once credentials are actually posted.
      const [{ createSupabaseBrowserClient }, { clearOfflineMirror }] = await Promise.all([
        import("@/lib/supabase/client"),
        import("@/lib/offline/db"),
      ]);
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Drop any previous user's offline sidebar mirror so this session never
      // paints stale cross-account folders/tags.
      await clearOfflineMirror();
      // Switch client-side prefs (palette, fonts, model choice) to this
      // account's own scoped keys.
      if (data.user) {
        const { setActiveUser } = await import("@/lib/settings");
        setActiveUser(data.user.id);
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed.");
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
          <CardTitle className="editorial-display text-2xl">Sign in</CardTitle>
          <CardDescription className="italic">Welcome back to your Second Brain.</CardDescription>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href="/signup" className="font-medium text-foreground hover:underline">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

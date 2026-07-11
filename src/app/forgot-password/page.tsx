"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      // supabase-js loads at submit time — it's most of this page's JS.
      const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const supabase = createSupabaseBrowserClient();
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        (typeof window !== "undefined" ? window.location.origin : "");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/callback?redirect=/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset email.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>We&apos;ll email you a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>, a reset link is on its
              way. Open it on this device to set a new password.
            </p>
          ) : (
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
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

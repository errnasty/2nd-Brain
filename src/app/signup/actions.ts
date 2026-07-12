"use server";

import { timingSafeEqual } from "node:crypto";

export type InviteSignupResult =
  | { ok: true }
  | { ok: false; error: string };

function codeMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; length inequality already leaks
  // via the comparison anyway, so short-circuit on it.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Server-enforced invite-gated signup. Active only when SIGNUP_INVITE_CODE is
 * set. Creates the account with the service-role admin API (email
 * pre-confirmed) so self-hosters can turn OFF public signups in the Supabase
 * dashboard ("Allow new users to sign up") — otherwise the anon-key
 * `auth.signUp` endpoint would still accept direct requests that skip the
 * invite check. The caller signs in with the password afterwards.
 */
export async function inviteSignupAction(
  email: string,
  password: string,
  inviteCode: string,
): Promise<InviteSignupResult> {
  const expected = process.env.SIGNUP_INVITE_CODE;
  if (!expected) {
    return { ok: false, error: "Invite signup is not enabled on this server." };
  }
  if (!codeMatches(inviteCode.trim(), expected)) {
    return { ok: false, error: "Invalid invite code." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — invite signup unavailable.",
    };
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    // Duplicate email etc. — surface Supabase's message, it's user-appropriate.
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

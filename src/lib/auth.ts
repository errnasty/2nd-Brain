import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * React.cache() memoizes by argument identity for the lifetime of a single
 * server request. Layout + page + nested server actions all share the same
 * Supabase client + getUser() round-trip instead of running it 2-3 times.
 */
const getAuthOnce = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
});

/** Returns the current Supabase user or redirects to /login. Use in server components & server actions. */
export async function requireUser() {
  const { user, supabase } = await getAuthOnce();
  if (!user) redirect("/login");
  return { user, supabase };
}

/** Same as requireUser but returns a JSON-shaped error for API routes (no redirect). */
export async function getApiUser() {
  const { user, supabase } = await getAuthOnce();
  if (!user) {
    return { user: null as null, supabase, error: { status: 401, message: "Unauthorized" } };
  }
  return { user, supabase, error: null };
}

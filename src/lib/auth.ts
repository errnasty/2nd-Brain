import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const isDesktop = process.env.APP_RUNTIME === "desktop";

/**
 * React.cache() memoizes by argument identity for the lifetime of a single
 * server request. Layout + page + nested server actions all share the same
 * Supabase client + auth round-trip instead of running it 2-3 times.
 *
 * Desktop: use getSession() (reads the locally stored token, NO network) so
 * navigation stays instant/offline; the renderer refreshes the token in the
 * background while online. Also ensures the local `profiles` row exists.
 */
const getAuthOnce = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (isDesktop) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (user) {
      const { ensureLocalProfile } = await import("@/lib/db/local-profile");
      await ensureLocalProfile(user.id, user.email ?? null);
    }
    return { user, supabase };
  }
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

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Returns the current Supabase user or redirects to /login. Use in server components & server actions. */
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { user, supabase };
}

/** Same as requireUser but throws a JSON-shaped error for API routes (no redirect). */
export async function getApiUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { user: null as null, supabase, error: { status: 401, message: "Unauthorized" } };
  }
  return { user, supabase, error: null };
}

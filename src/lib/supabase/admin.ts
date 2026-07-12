import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-only admin operations (creating
 * users for invite-gated signup, deleting accounts, …). NEVER import this
 * from client code — the service-role key bypasses RLS entirely.
 *
 * Returns null when the key isn't configured so callers can degrade
 * gracefully (e.g. invite signup reports "not configured" instead of 500).
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

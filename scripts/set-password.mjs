// One-time utility: set a password on an EXISTING Supabase auth user without
// changing its UUID, so all FK-linked data (folders, feeds, notes, settings)
// stays intact. Use this to migrate the magic-link developer account to
// email/password auth.
//
// Usage:
//   node scripts/set-password.mjs you@example.com "your-new-password"
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const password = process.argv[3];

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email || !password) {
  console.error('Usage: node scripts/set-password.mjs <email> "<password>"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Find the existing user by email (paginate to be safe).
let target = null;
for (let page = 1; page <= 20 && !target; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("Failed to list users:", error.message);
    process.exit(1);
  }
  target = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (data.users.length < 200) break; // last page
}

if (!target) {
  console.error(`No existing user found for ${email}. Aborting (won't create a new one).`);
  process.exit(1);
}

const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
  password,
  email_confirm: true, // mark confirmed so they can sign in immediately
});

if (updateError) {
  console.error("Failed to set password:", updateError.message);
  process.exit(1);
}

console.log(`✓ Password set for ${email} (user id ${target.id}). All data preserved.`);
console.log("You can now sign in with email + password at /login.");

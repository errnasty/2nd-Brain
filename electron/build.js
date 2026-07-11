// Builds the desktop app: a standalone Next server + Electron installer.
//
// The Next build runs with the cloud db branch (lazy postgres, dummy creds — it
// never connects at build time); at runtime Electron sets APP_RUNTIME=desktop so
// the server uses the embedded PGlite database instead.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const env = {
  ...process.env,
  DESKTOP_BUILD: "1", // → output: "standalone" in next.config.ts
  DATABASE_URL: process.env.DATABASE_URL || "postgres://build:build@localhost:5432/build",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://build.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "build-anon-key",
};

console.log("▶ next build (standalone)…");
execSync("npx next build", { cwd: root, stdio: "inherit", env });
// Direct `next build` bypasses npm's postbuild hook — stamp the service
// worker cache names here too so desktop builds also purge stale caches.
execSync("node scripts/inject-sw-buildid.mjs", { cwd: root, stdio: "inherit", env });

// PGlite is externalized (serverExternalPackages), so ensure it's present in the
// standalone server's node_modules for the runtime `require`.
const standaloneNM = path.join(root, ".next", "standalone", "node_modules", "@electric-sql");
fs.mkdirSync(standaloneNM, { recursive: true });
fs.cpSync(
  path.join(root, "node_modules", "@electric-sql", "pglite"),
  path.join(standaloneNM, "pglite"),
  { recursive: true },
);

console.log("▶ electron-builder…");
execSync("npx electron-builder", { cwd: root, stdio: "inherit", env: process.env });
console.log("✓ Desktop build complete → dist-desktop/");

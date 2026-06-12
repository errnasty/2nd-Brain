// Runs once when the Next.js server process starts. In the desktop (Electron)
// build this creates the embedded PGlite schema before any request hits the DB.
export async function register() {
  if (process.env.APP_RUNTIME === "desktop" && process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureLocalSchema } = await import("@/lib/db/local-bootstrap");
    await ensureLocalSchema();
    // Background cloud sync (no-ops unless DATABASE_URL is set).
    const { startSyncLoop } = await import("@/lib/sync/engine");
    startSyncLoop();
  }
}

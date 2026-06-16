// Single source of truth for the upload size cap, platform-aware.
//
// The desktop app uploads to the LOCAL server (no serverless body limit) so it
// can take the full 20MB the Server Action allows. The hosted web app goes
// through a serverless function whose request-body cap is far lower (~4.5MB
// effective on Netlify/Vercel) — the platform rejects the request with an opaque
// 413 BEFORE our action runs, so the client must enforce the real limit.

export const DESKTOP_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const WEB_MAX_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

/** True when running inside the Electron desktop shell (preload sets this). */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;
}

/** Effective max upload size for the current platform. */
export function maxUploadBytes(): number {
  return isDesktopRuntime() ? DESKTOP_MAX_UPLOAD_BYTES : WEB_MAX_UPLOAD_BYTES;
}

/** Human label for hints/toasts, e.g. "20MB" / "4.5MB". */
export function maxUploadLabel(): string {
  const mb = maxUploadBytes() / 1024 / 1024;
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

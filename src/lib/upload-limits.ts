// Single source of truth for the upload size cap.
//
// Both the desktop app and the hosted web app now allow the full 20MB the
// Server Action is configured for (`serverActions.bodySizeLimit` in
// next.config.ts). The web cap used to be ~4.5MB because a serverless function
// rejected a larger body with an opaque 413 before our action ever ran. Railway
// runs the app as an ordinary Node server and imposes no body-size ceiling of
// its own — only a 5-minute limit on how long the upload may take, which 20MB
// will not come close to on any usable connection.
//
// The two constants are kept separate so a future platform-specific cap has an
// obvious place to live rather than being reintroduced as a magic number.

export const DESKTOP_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const WEB_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** True when running inside the Electron desktop shell (preload sets this). */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;
}

/** Effective max upload size for the current platform. */
export function maxUploadBytes(): number {
  return isDesktopRuntime() ? DESKTOP_MAX_UPLOAD_BYTES : WEB_MAX_UPLOAD_BYTES;
}

/** Human label for hints/toasts, e.g. "20MB". */
export function maxUploadLabel(): string {
  const mb = maxUploadBytes() / 1024 / 1024;
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

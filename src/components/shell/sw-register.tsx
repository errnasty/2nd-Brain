"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js): installable PWA + offline
 * fallback for visited pages. Production-only — a SW in dev serves stale
 * chunks and fights HMR. Skipped on desktop (Electron is already offline-first
 * via the local DB).
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    if (navigator.userAgent.includes("Electron")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure just means no offline support — never block the app.
    });
  }, []);
  return null;
}

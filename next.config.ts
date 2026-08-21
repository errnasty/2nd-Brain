import type { NextConfig } from "next";

// Content-Security-Policy. Notes on the loose spots:
// - script-src 'unsafe-inline': Next's hydration bootstrap is inline without a
//   nonce setup (nonces need per-request middleware work — see the handover).
//   'unsafe-eval' is added in dev only (react-refresh needs it).
// - img-src https: — article bodies + feed favicons legitimately load images
//   from arbitrary feed domains (mirrors images.remotePatterns below).
// - connect-src: browser-side fetches go to our own API and the Supabase
//   project (auth/refresh). The origin comes from env so self-hosted Supabase
//   domains work; falls back to *.supabase.co when unset (e.g. lint in CI).
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "https://*.supabase.co";
  }
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^https:/, "wss:")}`,
  "worker-src 'self' blob:",
  "media-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Version-skew protection. Next stamps this id on asset requests and Server
  // Action calls, so when a tab left open across a deploy talks to the new
  // server it gets a clean full reload instead of a missing chunk or a
  // "Server Action was not found" error. Railway exposes RAILWAY_DEPLOYMENT_ID
  // to both the build and the runtime of the same deploy, so the two agree.
  // Absent locally and on the desktop build, where skew cannot happen.
  ...(process.env.RAILWAY_DEPLOYMENT_ID
    ? { deploymentId: process.env.RAILWAY_DEPLOYMENT_ID }
    : {}),
  // `output: "standalone"` is only needed for the Electron desktop build, which
  // bundles and runs the Next server locally. The Railway build leaves this
  // unset — it runs `next start` against a normal build — so it is gated
  // behind DESKTOP_BUILD.
  ...(process.env.DESKTOP_BUILD ? { output: "standalone" as const } : {}),
  // Keep heavy native/WASM deps out of the bundler — loaded at runtime only
  // when EMBEDDINGS_PROVIDER=local actually selects them. PGlite (desktop local
  // DB) is also externalized so it loads at runtime, not bundled in the cloud build.
  serverExternalPackages: ["@xenova/transformers", "officeparser", "@electric-sql/pglite"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    // Cache the RSC payload for visited dynamic routes in the router cache so
    // navigating away and back is instant. 5 minutes for dynamic pages (like
    // /feeds and /directory), 1 hour for static ones.
    staleTimes: {
      dynamic: 300,
      static: 3600,
    },
    // Auto-memoize client components (needs babel-plugin-react-compiler).
    // Replaces the hand-rolled useMemo churn in the nav components; adds some
    // build time in exchange for cheaper re-renders on folder/tag switching.
    reactCompiler: true,
  },
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The app is never embedded; Electron loads it top-level, not framed.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microphone stays self-allowed: Ask's voice input uses SpeechRecognition.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;

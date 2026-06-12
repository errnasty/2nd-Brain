import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `output: "standalone"` is only needed for the Electron desktop build, which
  // bundles and runs the Next server locally. The Netlify build leaves this
  // unset (its plugin handles output), so this is gated behind DESKTOP_BUILD.
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
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;

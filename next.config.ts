import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

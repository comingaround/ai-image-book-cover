import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The compose route reads the cover fonts from disk; ship them with it.
  outputFileTracingIncludes: {
    '/api/compose': ['./public/fonts/**'],
  },
  partialPrefetching: true,
  experimental: {
    // Set by `next upgrade --agent=security` (16.4.0 → 16.4.3).
    agentUpgrade: 'security',
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Cover fonts are read from disk by the compose route; make sure Vercel ships them with it.
  outputFileTracingIncludes: {
    '/api/compose': ['./public/fonts/**'],
  },
  partialPrefetching: true,
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

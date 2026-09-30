import type { NextConfig } from "next";

// The browser only ever talks to this Next.js origin. /api/* is forwarded to the Rails backend,
// so the session cookie is first-party and no CORS configuration is needed.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Lets a verification build (NEXT_DIST_DIR=.next-verify npm run build) run without touching the
  // .next folder a running `next dev` is serving from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  // Old address of the upload page.
  async redirects() {
    return [{ source: "/upload", destination: "/detect", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

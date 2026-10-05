import type { NextConfig } from "next";

// The browser only ever talks to this Next.js origin. /api/* is forwarded to the Rails backend,
// so the session cookie is first-party and no CORS configuration is needed.
// BACKEND_URL comes from .env. Rewrites are fixed at build time, so it must be set before `npm run build`;
// the localhost default applies to development only.
const backendUrl = process.env.BACKEND_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:4000");
if (!backendUrl) throw new Error("BACKEND_URL must be set (see frontend/.env.example) before building for production.");

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
  // Old addresses of the upload page; Upload / Detection is now part of Orders (links in sent emails, bookmarks).
  async redirects() {
    return ["/upload", "/detect", "/uploads"].map((source) => ({ source, destination: "/orders", permanent: false }));
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

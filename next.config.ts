import type { NextConfig } from "next";

// Static security headers (the CSP itself is set in proxy.ts, since it
// needs a fresh per-request nonce — see that file for why).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

// Supabase Storage stays in remotePatterns below for legacy media not
// yet moved by scripts/migrate-supabase-to-r2.ts; R2_PUBLIC_DOMAIN is
// added alongside it (not in place of it) so next/image keeps working
// for both during — and indefinitely after — that migration. Guarded
// on the env var actually being set so a build/dev run without R2
// configured yet doesn't fail Next's remotePatterns validation.
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "utkwwtdkhqvdshbjwikm.supabase.co",
    pathname: "/storage/v1/object/public/**",
  },
];

if (process.env.R2_PUBLIC_DOMAIN) {
  remotePatterns.push({
    protocol: "https",
    hostname: process.env.R2_PUBLIC_DOMAIN,
  });
}

const nextConfig = {
  // Bundles a minimal server + only the deps actually used into
  // .next/standalone — much smaller/lighter than `next start` on a
  // memory-constrained container (e.g. Render's free tier).
  output: "standalone",
  // Framework fingerprinting: Next.js sends an `X-Powered-By: Next.js`
  // response header by default — no reason to advertise the stack.
  poweredByHeader: false,
  reactStrictMode: true,
  // Explicit, not just relying on the (also false) default: never ship
  // browser source maps from a production build.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  images: {
    // Note: this only affects images rendered through next/image's
    // built-in Optimization API — this codebase deliberately renders
    // every image as a plain <img> (see the
    // `eslint-disable-next-line @next/next/no-img-element` comments
    // throughout), so minimumCacheTTL is inert today. Kept here (rather
    // than left out) so it's already correct the moment anything does
    // start using next/image, and because remotePatterns below is
    // required either way for next/image to be usable against Supabase
    // Storage URLs at all.
    minimumCacheTTL: 86400, // 24 hours
    remotePatterns,
  },
  experimental: {
    serverActions: {
      // Default is 1MB; the complaint form submits photos/videos as
      // FormData through a Server Action.
      bodySizeLimit: "30mb",
    },
  },
} satisfies NextConfig;

export default nextConfig;

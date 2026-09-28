// app/api/debug-client-ip/route.ts
//
// TEMPORARY DIAGNOSTIC — delete once the rate-limit client-IP question
// (09-26 audit S1) is answered. Both rate limiters currently key on the
// LEFTMOST X-Forwarded-For entry, which the visitor controls. Before
// switching to a proxy-set header we need to see, on the real Render +
// Cloudflare path, which headers arrive and which ones a client can
// forge: request this once normally and once with forged
// X-Forwarded-For / CF-Connecting-IP / True-Client-IP / X-Real-IP
// headers, through both janatardipak.com and the .onrender.com URL.
//
// Public on purpose, so the forged-header test works from curl without
// an admin cookie. That's harmless: it only echoes the caller's OWN
// request headers back to them, from a fixed allowlist (never cookies
// or authorization), plus the bare names of the rest. No database
// access, no logging.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const IP_HEADERS = [
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
  "forwarded",
  "x-client-ip",
  "x-envoy-external-address",
  "cf-ipcountry",
  "cf-ray",
  "cf-worker",
  "x-forwarded-proto",
  "x-forwarded-host",
  "via",
];

function handle(request: Request) {
  const ipHeaders = Object.fromEntries(IP_HEADERS.map((h) => [h, request.headers.get(h)]));
  const otherHeaderNames = [...request.headers.keys()].filter((h) => !IP_HEADERS.includes(h)).sort();

  return NextResponse.json(
    { host: request.headers.get("host"), ipHeaders, otherHeaderNames },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  return handle(request);
}

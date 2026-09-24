// app/api/admin/debug-fb-resolve/route.ts
//
// TEMPORARY DIAGNOSTIC — delete once the "Way R" (Facebook short-link
// resolver) viability question is answered. Answers one thing: from
// THIS server's IP (Render's datacenter ASN, not a residential IP), does
// Facebook answer `/share/{v,r,p}/<code>` with a 302 + Location pointing
// at the canonical URL, or block us — and does the User-Agent matter?
//
// Near-zero egress: redirect: "manual" (never follows to the target
// page), every response body is cancelled unread, one request at a
// time. Admin-only; returns JSON.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

const TEST_URLS = [
  "https://www.facebook.com/share/v/14rLsUHaMko/",
  "https://www.facebook.com/share/v/1CVvJ7ojL5/",
  "https://www.facebook.com/share/r/19bJDRRs5c/",
  "https://www.facebook.com/share/p/1DSbpaqaMj/",
];

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const FB_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const BROWSER_EXTRAS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const VARIANTS: { name: string; headers: Record<string, string> }[] = [
  { name: "a_facebookexternalhit", headers: { "User-Agent": FB_UA } },
  { name: "b_curl", headers: { "User-Agent": "curl/8.0" } },
  { name: "c_chrome", headers: { "User-Agent": CHROME_UA } },
  { name: "d_chrome_plus_accept", headers: { "User-Agent": CHROME_UA, ...BROWSER_EXTRAS } },
  { name: "e_facebookexternalhit_plus_accept", headers: { "User-Agent": FB_UA, ...BROWSER_EXTRAS } },
];

const TIMEOUT_MS = 8000;
const KEEP_HEADERS = ["location", "content-type", "content-length", "cache-control", "x-fb-debug", "x-fb-trip-id", "server", "proxy-status", "retry-after"];

function classify(status: number, location: string | null): string {
  if (status >= 300 && status < 400 && location) {
    if (/\/login|checkpoint|captcha/i.test(location)) return "BLOCKED_REDIRECT_TO_LOGIN_OR_CHECKPOINT";
    if (/\/share\//.test(location)) return "REDIRECT_TO_ANOTHER_SHARE_URL";
    return "RESOLVED";
  }
  if (status === 400 || status === 403 || status === 429) return `BLOCKED_${status}`;
  if (status === 200) return "OK_200_NO_REDIRECT (would need body parsing)";
  return `OTHER_${status}`;
}

async function probe(url: string, headers: Record<string, string>) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Never download the body — headers are all this test needs.
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    const kept: Record<string, string> = {};
    for (const name of KEEP_HEADERS) {
      const value = res.headers.get(name);
      if (value) kept[name] = value.slice(0, 300);
    }
    return {
      status: res.status,
      verdict: classify(res.status, location),
      location,
      headers: kept,
      headerNames: [...res.headers.keys()],
      ms: Date.now() - started,
    };
  } catch (err) {
    return { status: 0, verdict: "NETWORK_ERROR", error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

// Cloudflare's trace endpoint: a few hundred bytes, tells us which
// egress IP / colo Facebook actually sees from this container.
async function egressInfo() {
  try {
    const res = await fetch("https://1.1.1.1/cdn-cgi/trace", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    return Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.split("="))
        .filter(([k]) => k === "ip" || k === "colo" || k === "loc")
    );
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = [];
  for (const url of TEST_URLS) {
    for (const variant of VARIANTS) {
      results.push({ url, variant: variant.name, ...(await probe(url, variant.headers)) });
    }
  }

  return NextResponse.json(
    {
      ranAt: new Date().toISOString(),
      host: process.env.RENDER ? "render" : "non-render",
      egress: await egressInfo(),
      summary: results.map((r) => `${r.variant.padEnd(34)} ${r.status} ${r.verdict}  ${r.url}`),
      results,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

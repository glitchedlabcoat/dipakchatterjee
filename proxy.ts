// proxy.ts  (project root — replaces middleware.ts under Next.js 16)
//
// Runs on every request (matcher below excludes only static assets).
// Two independent jobs:
//
//   1. Security headers, site-wide: a fresh per-request CSP nonce is
//      generated and set on both the outgoing request (so Next.js's own
//      hydration/RSC inline scripts pick it up automatically — see
//      node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
//      and the response (so the browser enforces it). This requires
//      every page to render dynamically — /admin/login and the 404 page
//      are explicitly forced dynamic (see their files) specifically so
//      this holds site-wide with no exceptions.
//
//   2. Admin auth gate, /admin/* (and /dashboard/*, reserved for the
//      same protected area) only: refresh the Supabase session and,
//      when FEATURE_FLAGS.REQUIRE_OTP is on, also require a valid,
//      non-expired OTP session cookie (see lib/otp-session.ts) — the
//      second factor completed at login. A visitor with neither goes
//      to /admin/login; one who's passed the password check but not
//      yet the OTP (the admin_pending_2fa cookie, set right after
//      password verification — see app/admin/login/actions.ts) goes to
//      /admin/verify-otp instead, so a stuck step 1 doesn't look like a
//      failed login. A fully verified admin is redirected away from
//      both /admin/login and /admin/verify-otp. Scoped to these
//      prefixes so public pages never pay for an extra Supabase auth
//      round trip.
//
//      With the flag off, a Supabase session alone counts as verified
//      — no cookie is checked — so a successful login goes straight to
//      /admin and /admin/verify-otp is simply never reached
//      (requestLoginOtp() skips issuing the pending-2FA cookie in that
//      case too, see app/admin/login/actions.ts). Nothing here deletes
//      the OTP gate, it's just short-circuited: flip the flag back on
//      and this file's logic reverts with no further changes.
//
// A Server Action invoked from a client component on one of these
// pages (e.g. LoginForm.tsx's requestLoginOtp()) POSTs back to that
// same page's own URL — so, with the flag off, the instant the
// client's own signInWithPassword() call has set the Supabase session
// cookie, that very next POST to /admin/login already looks
// "verified" to the check above. Substituting a redirect Response for
// a Server Action's own request corrupts Next's action-response
// protocol (it isn't the encoded result the client's fetch is
// expecting) and surfaces to the browser as a bare "Failed to fetch" —
// the action never gets to return its result, so LoginForm.tsx's own
// window.location.assign("/admin") never runs, even though the user
// really is signed in underneath. `isServerAction` below exempts these
// requests from every redirect branch for that reason: the action
// itself decides what to return (including throwing a normal,
// try/catch-able error if it's genuinely unauthorized), and the client
// does its own navigation once that resolves.
//
// Note: proxy.ts always runs on the Node.js runtime (not Edge), so the
// full Supabase SSR client works here without any edge-compatibility
// workarounds.

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import {
  OTP_SESSION_COOKIE,
  PENDING_2FA_COOKIE,
  verifyOtpSessionToken,
  verifyPending2faToken,
} from "@/lib/otp-session";

function supabaseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "";
  }
}

const SUPABASE_HOST = supabaseHost();

// Cloudflare R2 — every admin media URL (and, once R2_COMPLAINT_BUCKET_NAME
// is configured, complaint attachments) resolves to one of these two
// hosts. R2_PUBLIC_DOMAIN serves the public admin-media bucket directly
// (see lib/r2.ts); the raw r2.cloudflarestorage.com endpoint is what
// every *presigned* URL points at instead (see lib/r2-complaints.ts) —
// admin's signed GET for a private complaint attachment, and the
// browser's own direct signed PUT when uploading one. Both need to be
// allowed here or the browser blocks the request outright regardless of
// the URL being correctly signed; CSP is enforced independently of (and
// before) the actual HTTP response.
const R2_PUBLIC_HOST = process.env.R2_PUBLIC_DOMAIN ?? "";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ENDPOINT_HOST = R2_ACCOUNT_ID ? `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "";
const R2_IMG_SOURCES = [R2_PUBLIC_HOST, R2_ENDPOINT_HOST]
  .filter(Boolean)
  .map((host) => `https://${host}`)
  .join(" ");

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  // style-src allows 'unsafe-inline': the site's dynamic theming (CTA
  // button colors, the gallery's transform/transition, per-request CSS
  // custom properties) relies on inline `style="..."` attributes, which
  // CSP nonces cannot cover (nonces only apply to <style> elements, not
  // to the style attribute on arbitrary elements). script-src is kept
  // strict — that's the directive that actually stops injected-script
  // XSS — so this is a deliberate, scoped trade-off, not a blanket
  // weakening of the policy.
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://${SUPABASE_HOST}${R2_IMG_SOURCES ? ` ${R2_IMG_SOURCES}` : ""};
    media-src 'self' https://${SUPABASE_HOST}${R2_IMG_SOURCES ? ` ${R2_IMG_SOURCES}` : ""};
    connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}${R2_ENDPOINT_HOST ? ` https://${R2_ENDPOINT_HOST}` : ""};
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.facebook.com https://www.instagram.com;
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/dashboard");

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (isAdminRoute) {
    const { user } = await updateSession(request, response);
    const isLoginRoute = pathname === "/admin/login";
    const isVerifyOtpRoute = pathname === "/admin/verify-otp";
    // See the comment above: never substitute a redirect for a Server
    // Action's own request, only for an actual page load.
    const isServerAction = request.headers.has("next-action");

    // Both cookies are bound to whichever user set them — a stale
    // cookie from a previous account (or a signed session for a user
    // who's since signed out) doesn't count for either.
    const otpSession = verifyOtpSessionToken(request.cookies.get(OTP_SESSION_COOKIE)?.value);
    const isOtpVerified = FEATURE_FLAGS.REQUIRE_OTP
      ? Boolean(user && otpSession && otpSession.userId === user.id)
      : Boolean(user);

    const pending2fa = verifyPending2faToken(request.cookies.get(PENDING_2FA_COOKIE)?.value);
    const isPending2fa = Boolean(user && pending2fa && pending2fa.userId === user.id);

    if (isServerAction) {
      // Let it through as-is; requireAdmin()/requireOwner() (and the
      // OTP actions' own checks) are the real authorization boundary
      // for actions, independent of this gate.
    } else if (isVerifyOtpRoute) {
      if (isOtpVerified) {
        response = NextResponse.redirect(new URL("/admin", request.url));
      } else if (!isPending2fa) {
        // Can't verify a code without having completed the password
        // step first — nothing to check against.
        response = NextResponse.redirect(new URL("/admin/login", request.url));
      }
    } else if (isLoginRoute) {
      if (isOtpVerified) {
        response = NextResponse.redirect(new URL("/admin", request.url));
      }
      // Otherwise let /admin/login render even with a pending 2FA
      // cookie present — re-submitting credentials there is how a
      // stuck step 1 gets a fresh code.
    } else if (!isOtpVerified) {
      // Every other /admin (and /dashboard) route requires a verified
      // session. Mid-2FA goes back to the OTP prompt rather than the
      // credentials form.
      response = NextResponse.redirect(new URL(isPending2fa ? "/admin/verify-otp" : "/admin/login", request.url));
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

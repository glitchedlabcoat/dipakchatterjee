// app/not-found.tsx
//
// Site-wide 404 — shown for any unmatched URL and for notFound() calls
// that no nearer not-found.tsx handles.
//
// Must render dynamically. Without this file Next serves its built-in
// 404, which is prerendered at build time: its inline scripts carry no
// CSP nonce, so proxy.ts's per-request `script-src 'nonce-…'
// 'strict-dynamic'` policy blocks every one of them. `await connection()`
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md)
// defers rendering to request time, so Next stamps the request's nonce on
// its scripts like on every other page. Confirm with `next build`: the
// route table should list `ƒ /_not-found`, not `○ /_not-found`.
//
// Renders inside the root layout only (not the (site) layout), so it
// stays free of Supabase reads — a 404 from a crawler or bot costs
// nothing on the database.

import Link from "next/link";
import { connection } from "next/server";

export const metadata = {
  title: "Page not found — Dipak Chatterjee",
};

export default async function NotFound() {
  await connection();

  return (
    <main className="bg-paper-100 min-h-screen flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-ink-400 tracking-wide">404</p>
        <h1 className="mt-2 font-display text-3xl md:text-4xl text-navy-900 leading-tight">
          Page not found
        </h1>
        <p className="mt-4 text-ink-600 leading-relaxed">
          The page you were looking for doesn&apos;t exist or may have been moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900"
        >
          ← Back to the homepage
        </Link>
      </div>
    </main>
  );
}

// components/admin/AdminTopProgressBar.tsx
//
// Deliberately no external dependency (e.g. nextjs-toploader) — this is
// a handful of lines of CSS-only feedback, and the dashboard is meant to
// be getting lighter, not gaining a new package for one progress bar.

"use client";

import { useAdminNavPending } from "@/components/admin/AdminNavPendingContext";

export default function AdminTopProgressBar() {
  const { isPending } = useAdminNavPending();

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-x-0 top-0 z-[70] h-0.5 bg-saffron transition-opacity duration-150 ${
        isPending ? "opacity-100 animate-pulse" : "opacity-0"
      }`}
    />
  );
}

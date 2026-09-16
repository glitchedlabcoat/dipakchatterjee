// components/admin/AdminNavPendingContext.tsx
//
// /admin/* navigation has no loading.tsx-maskable head start — the
// shared layout re-runs an auth + profile fetch on every single nav
// (see lib/admin-auth.ts) and Next's own docs are explicit that a
// layout's own uncached data access blocks navigation regardless of any
// loading.tsx nested inside it. Wrapping router.push() in useTransition
// gives an isPending signal that covers that entire window (not just
// the page segment's own streamed fetch), so this is the one thing that
// can show *any* feedback the instant an admin clicks — and, more
// importantly, is what lets every nav trigger disable itself while a
// navigation is already in flight, so rage-clicking multiple tabs can't
// pile up multiple concurrent RSC fetches against the server.

"use client";

import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminNavPendingContextValue = {
  isPending: boolean;
  navigate: (href: string) => void;
};

const AdminNavPendingContext = createContext<AdminNavPendingContextValue | null>(null);

export function AdminNavPendingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router]
  );

  const value = useMemo(() => ({ isPending, navigate }), [isPending, navigate]);

  return <AdminNavPendingContext.Provider value={value}>{children}</AdminNavPendingContext.Provider>;
}

export function useAdminNavPending() {
  const ctx = useContext(AdminNavPendingContext);
  if (!ctx) {
    throw new Error("useAdminNavPending must be used within an AdminNavPendingProvider");
  }
  return ctx;
}

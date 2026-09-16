// lib/admin-auth.ts
//
// Every /admin/* navigation is fully dynamic (no route caching — see the
// CSP-nonce project memory), and the signed-in user + their profile row
// are needed independently by app/admin/(protected)/layout.tsx and,
// depending on the route, that route's own page.tsx (Overview, Settings).
// Without this, each of those call sites hit Supabase Auth / Postgres
// separately — up to 3 sequential round trips before any page-specific
// data fetch even starts, on every single admin nav. react's cache()
// memoizes by arguments for the lifetime of one render (one request),
// so calling these from multiple components in the same tree collapses
// repeat calls into the one underlying query.

import { cache } from "react";
import { createClient } from "@/utils/supabase/server";
import type { Profile } from "@/types/domain";

export const getAuthedUser = cache(async () => {
  const supabase = await createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    console.error("[getAuthedUser] auth.getUser() failed:", err);
    return null;
  }
});

// Selects the full row (a strict superset of every call site's previous
// narrower select) so this one query can serve all of them.
export const getViewerProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  try {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    return data as Profile | null;
  } catch (err) {
    console.error("[getViewerProfile] profile fetch failed:", err);
    return null;
  }
});

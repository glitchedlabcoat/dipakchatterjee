// utils/supabase/public.ts
//
// Use this ONLY inside a function wrapped in `unstable_cache` for public,
// anonymous reads (see lib/cache.ts + the (site) pages/layout that use
// it). It's a plain @supabase/supabase-js client with no cookie access —
// deliberately not utils/supabase/server.ts's createClient(), which
// reads cookies() on every call. Calling a Dynamic API like cookies()
// from inside a function passed to unstable_cache throws at runtime
// (Next.js tracks and forbids it, since a cached function's output must
// not depend on per-request state), and this app's Supabase server
// client always calls cookies() up front to detect an admin session —
// something a cached, shared-across-every-visitor read must never do
// anyway. Every caller here is always anonymous, which is exactly right:
// these reads only ever return the same RLS-gated public rows regardless
// of who's asking.
//
// Never use this for admin/mutating code paths — it can't see an admin's
// session, so any query relying on is_admin() in RLS will simply see
// nothing back.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createPublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

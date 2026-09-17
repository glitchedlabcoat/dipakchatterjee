// utils/supabase/admin.ts
//
// Service-role client that bypasses RLS entirely. Use ONLY from trusted
// server-only code (Server Actions), never from a "use client" file or
// anything that ships to the browser — the service role key must never
// reach client code.
//
// Its one legitimate job in this app: letting an anonymous citizen submit
// a complaint. The complaints/complaint_media tables and the
// complaint-media bucket have no public insert policy at all (see the
// complaints migration), so this is the only code path that can create a
// complaint — there is no way to do it directly against the Supabase
// REST/Storage API.
//
// `persistSession: false` alone does NOT stop auth-js from starting its
// background refresh ticker — that's gated only on `autoRefreshToken`
// (default true), independently of persistSession. See
// utils/supabase/public.ts's comment for the full explanation (this was
// the root cause of Render's repeated OOM crashes): every
// createServiceClient() call here left a permanent, never-cleared
// setInterval + client instance in memory. A service-role key has no
// user session to refresh in the first place, so autoRefreshToken:false
// is pure correctness.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );
}

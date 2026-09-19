// app/api/ping/route.ts
//
// Dual-layer keep-alive for an external uptime monitor (UptimeRobot):
//
//   Layer 1 — Render: every ping returns 200 + { status, uptime }
//   immediately, keeping the free-tier web instance from spinning down.
//
//   Layer 2 — Supabase: the free tier pauses a project after 7 days
//   without activity. On every 4th UTC day we fire one tiny anonymous
//   read so the project never gets near that threshold, instead of
//   hitting the database on every ping.
//
// The DB query is fire-and-forget: the response never waits on it and can
// never fail because of it. State lives in module memory (this app runs as
// one long-lived Render instance), so a restart just means at most one
// extra query on the next ping that lands on a "due" day.
//
// Cadence uses the UTC epoch-day count, not getDate() % 4: day-of-month
// multiples of 4 leave a gap of up to 7 days across month boundaries
// (28th -> 4th in a 31-day month), which is exactly Supabase's pause
// threshold. Epoch days are a strict 4-day cycle with no such gap.
//
// The query goes through createPublicClient() (auto-refresh ticker
// disabled — see utils/supabase/public.ts for why that matters here) and
// reads site_settings, which is already anon-readable via RLS, so no
// dedicated table or migration is needed.

import { NextResponse } from "next/server";
import { createPublicClient } from "@/utils/supabase/public";

export const dynamic = "force-dynamic";

const DB_PING_EVERY_DAYS = 4;
const MS_PER_DAY = 86_400_000;

let lastDbPingDate: string | null = null; // 'YYYY-MM-DD' (UTC) of the last successful DB ping
let dbPingInFlight = false;

function maybePingDatabase(): void {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const isDueDay = Math.floor(now.getTime() / MS_PER_DAY) % DB_PING_EVERY_DAYS === 0;

  if (!isDueDay || lastDbPingDate === today || dbPingInFlight) return;

  dbPingInFlight = true;
  void (async () => {
    try {
      const { error } = await createPublicClient().from("site_settings").select("id").limit(1);
      if (error) throw new Error(error.message);
      lastDbPingDate = today;
      console.log(`[keep-alive] Supabase ping OK (${today})`);
    } catch (err) {
      // lastDbPingDate stays unchanged, so the next ping today retries.
      console.error("[keep-alive] Supabase ping FAILED:", err instanceof Error ? err.message : err);
    } finally {
      dbPingInFlight = false;
    }
  })();
}

function handle() {
  maybePingDatabase();
  return NextResponse.json(
    { status: "ok", uptime: process.uptime() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  return handle();
}

// UptimeRobot's default check method is HEAD.
export async function HEAD() {
  return handle();
}

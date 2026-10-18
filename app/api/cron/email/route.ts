// app/api/cron/email/route.ts
//
// The email scheduler's entry point: queues a due reminder, sends due and
// retryable messages, fetches pending inbound bodies, and applies log
// retention (see lib/email/dispatch.ts). Every step is idempotent, so the
// caller can fire it as often as it likes; every 15 minutes is enough.
//
// This route is not a scheduler by itself. Something outside the web
// process has to call it: the documented option is Supabase pg_cron +
// pg_net (supabase/snippets/email-scheduler-pg-cron.sql), and any HTTP
// scheduler that can send a header works too. It must send
// `Authorization: Bearer <CRON_SECRET>`. With CRON_SECRET unset the route
// is disabled (404), the same as /api/cron/purge-complaints.
//
// The response holds counts only: no addresses, subjects or content.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/email/config";
import { runEmailDispatch } from "@/lib/email/dispatch";
import { createEmailRuntime } from "@/lib/email/runtime";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function handle(request: Request) {
  const secret = getCronSecret();
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report = await runEmailDispatch(createEmailRuntime());
  return NextResponse.json(report, {
    status: report.errors.length ? 500 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;

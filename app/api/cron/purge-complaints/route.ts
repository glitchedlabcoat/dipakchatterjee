// app/api/cron/purge-complaints/route.ts
//
// Wire this to any external scheduler (Vercel Cron, an uptime-ping
// service, Supabase pg_cron + pg_net, etc.) to purge expired complaints
// independent of an admin ever opening the dashboard — the dashboard
// itself also purges on every load, so this is a belt-and-suspenders
// mechanism for true background deletion. Callers must send CRON_SECRET
// as `Authorization: Bearer <secret>`. With CRON_SECRET unset the route
// is disabled (404): every call runs a service-role Supabase query, so an
// open route would let anyone generate database traffic and log volume.

import { NextResponse } from "next/server";
import { purgeExpiredComplaints } from "@/lib/complaints-cleanup";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await purgeExpiredComplaints();
  return NextResponse.json(result);
}

// app/api/webhooks/resend/route.ts
//
// The one Resend webhook endpoint (Resend's free plan allows one): subscribe
// it to `email.received` plus the delivery events (`email.sent`,
// `email.delivered`, `email.delivery_delayed`, `email.bounced`,
// `email.complained`, `email.failed`, `email.suppressed`).
//
// Order matters: size limit, then the Svix signature over the RAW body
// (RESEND_WEBHOOK_SECRET), and only then JSON parsing. Unsigned, stale
// (> 5 min) or forged requests get 401 and touch nothing. With
// RESEND_WEBHOOK_SECRET unset the route is disabled (404).
//
// Replays and Resend's own retries are harmless: received mail
// de-duplicates on its Resend id, and delivery events only ever move a
// message's status forward. Unknown event types are acknowledged and
// ignored, so Resend doesn't keep retrying them.

import { NextResponse, after } from "next/server";
import { getVerifiedDomain, getWebhookSecret } from "@/lib/email/config";
import { verifyWebhookSignature } from "@/lib/email/webhook-signature";
import { applyDeliveryEvent, fetchInboundBody, ingestReceived, isDeliveryEvent, parseReceivedEvent } from "@/lib/email/inbound";
import { createEmailRuntime } from "@/lib/email/runtime";

export const dynamic = "force-dynamic";

// Webhook payloads carry metadata only (no bodies or attachments), so
// they're small; anything bigger isn't a genuine Resend event.
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const secret = getWebhookSecret();
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const valid = verifyWebhookSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret
  );
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: { type?: unknown; created_at?: unknown; data?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = typeof event.type === "string" ? event.type : "";

  const runtime = createEmailRuntime();

  if (type === "email.received") {
    const parsed = parseReceivedEvent(event.data, event.created_at);
    if (!parsed.ok) return NextResponse.json({ ok: true, ignored: parsed.error });

    const result = await ingestReceived(runtime.store, parsed.value, getVerifiedDomain());
    if (result.status === "stored") {
      const id = result.id;
      // The body is fetched after responding; if that fails, the
      // scheduled dispatch retries it.
      after(async () => {
        try {
          await fetchInboundBody(runtime.store, runtime.fetchReceived, id);
        } catch (err) {
          console.error("[resend-webhook] body fetch failed:", err instanceof Error ? err.message : "unknown");
        }
      });
    }
    return NextResponse.json({ ok: true, result: result.status });
  }

  if (isDeliveryEvent(type)) {
    const result = await applyDeliveryEvent(runtime.store, type, event.data, event.created_at);
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ ok: true, ignored: "unhandled event type" });
}

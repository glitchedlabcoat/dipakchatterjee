// lib/email/webhook-signature.ts
//
// Verifies a Resend webhook. Resend signs webhooks with Svix; this is the
// manual verification Svix documents, so no extra dependency is needed:
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   key            = base64-decode(secret without its "whsec_" prefix)
//   signature      = base64(HMAC-SHA256(key, signed content))
//   svix-signature = space-separated "v1,<signature>" entries; any match passes
// Compared in constant time, and the timestamp must be within five
// minutes of now (Svix's own default tolerance), which bounds replays.
// The body must be the raw request text, never re-serialized JSON.

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function computeWebhookSignature(secret: string, id: string, timestamp: string, payload: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaders,
  secret: string,
  nowMs: number = Date.now()
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  if (id.length > 200 || signature.length > 2000) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = computeWebhookSignature(secret, id, timestamp, payload);
  return signature
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      const comma = entry.indexOf(",");
      if (comma < 0) return false;
      return entry.slice(0, comma) === "v1" && safeEqual(entry.slice(comma + 1), expected);
    });
}

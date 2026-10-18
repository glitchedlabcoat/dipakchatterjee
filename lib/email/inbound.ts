// lib/email/inbound.ts
//
// Handles verified Resend webhook events (the signature is checked first,
// in app/api/webhooks/resend/route.ts):
//
//   email.received  Feature D. Stores the message's metadata, then fetches
//                   its body from Resend's Received emails API (webhooks
//                   carry metadata only). Duplicate deliveries collapse on
//                   the unique provider_email_id. Only mail addressed to
//                   the verified domain is kept. Attachments are recorded
//                   as metadata (name, type, size) and never downloaded.
//                   Nothing in a received message is ever acted on: it
//                   can't trigger a reply, a status change or a
//                   notification, however official it looks.
//
//   email.sent / delivered / delivery_delayed / bounced / complained /
//   failed / suppressed
//                   Delivery status for messages this site sent, matched
//                   on Resend's email id. Applied by rank, so a late or
//                   repeated event can't move a message backwards (e.g. a
//                   delayed event arriving after delivered is ignored).

import type { EmailStatus, EmailStore } from "@/lib/email/store";
import type { ReceivedResult } from "@/lib/email/resend";
import type { Json } from "@/types/database.types";
import { isOnDomain, isValidEmail, normalizeEmail, parseMailbox, sanitizeDisplayName } from "@/lib/email/address";

export const MAX_TEXT_BODY = 100_000;
export const MAX_HTML_BODY = 300_000;
export const MAX_ATTACHMENTS = 50;
export const MAX_BODY_FETCH_ATTEMPTS = 5;

export type InboundAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number | null;
  inline: boolean;
};

export type ParsedReceived = {
  providerEmailId: string;
  from: { name: string | null; address: string };
  to: string[];
  cc: string[];
  subject: string | null;
  messageId: string | null;
  receivedAt: string;
  attachments: InboundAttachment[];
};

const PROVIDER_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
// An RFC 5322 Message-ID as it appears in headers: <local@domain>, no
// whitespace or angle brackets inside. Anything else is dropped so it can
// never be used to inject a header into a reply.
const MESSAGE_ID_RE = /^<[^<>\s]{3,500}>$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function addressList(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value.slice(0, max)) {
    if (typeof entry !== "string") continue;
    const parsed = parseMailbox(entry);
    if (parsed) out.push(parsed.address);
  }
  return out;
}

export function cleanFilename(name: unknown): string {
  if (typeof name !== "string") return "attachment";
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().slice(0, 200);
  return cleaned || "attachment";
}

export function cleanMessageId(value: unknown): string | null {
  return typeof value === "string" && MESSAGE_ID_RE.test(value.trim()) ? value.trim() : null;
}

function cleanAttachments(value: unknown): InboundAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ATTACHMENTS)
    .map(asRecord)
    .filter((a): a is Record<string, unknown> => a !== null)
    .map((a) => ({
      id: typeof a.id === "string" ? a.id.slice(0, 100) : "",
      filename: cleanFilename(a.filename),
      contentType: typeof a.content_type === "string" ? a.content_type.slice(0, 100).replace(/[^\w.+/-]/g, "") : "application/octet-stream",
      size: typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? a.size : null,
      inline: a.content_disposition === "inline",
    }));
}

export type ParseResult = { ok: true; value: ParsedReceived } | { ok: false; error: string };

/** Validates the `data` object of an email.received event. */
export function parseReceivedEvent(data: unknown, eventCreatedAt?: unknown): ParseResult {
  const d = asRecord(data);
  if (!d) return { ok: false, error: "missing data" };

  const providerEmailId = typeof d.email_id === "string" ? d.email_id : "";
  if (!PROVIDER_ID_RE.test(providerEmailId)) return { ok: false, error: "invalid email_id" };

  const from = typeof d.from === "string" ? parseMailbox(d.from) : null;
  if (!from) return { ok: false, error: "invalid from" };

  const to = [...new Set([...addressList(d.to), ...addressList(d.received_for)])];
  if (to.length === 0) return { ok: false, error: "no valid recipients" };

  const createdAt = typeof d.created_at === "string" ? d.created_at : typeof eventCreatedAt === "string" ? eventCreatedAt : null;
  const receivedMs = createdAt ? Date.parse(createdAt) : NaN;

  return {
    ok: true,
    value: {
      providerEmailId,
      from,
      to,
      cc: addressList(d.cc),
      subject: typeof d.subject === "string" ? d.subject.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 998) : null,
      messageId: cleanMessageId(d.message_id),
      receivedAt: Number.isFinite(receivedMs) ? new Date(receivedMs).toISOString() : new Date().toISOString(),
      attachments: cleanAttachments(d.attachments),
    },
  };
}

export type IngestResult =
  | { status: "stored"; id: string }
  | { status: "duplicate"; id: string }
  | { status: "ignored"; reason: string };

export async function ingestReceived(
  store: EmailStore,
  parsed: ParsedReceived,
  verifiedDomain: string | null
): Promise<IngestResult> {
  if (!verifiedDomain) return { status: "ignored", reason: "no verified domain configured" };
  if (!parsed.to.some((address) => isOnDomain(address, verifiedDomain))) {
    return { status: "ignored", reason: "not addressed to the verified domain" };
  }

  const result = await store.insertInbound({
    provider_email_id: parsed.providerEmailId,
    message_id: parsed.messageId,
    from_address: parsed.from.address,
    from_name: parsed.from.name,
    to_addresses: parsed.to,
    cc_addresses: parsed.cc,
    subject: parsed.subject,
    attachments: parsed.attachments as unknown as Json,
    received_at: parsed.receivedAt,
  });
  return result.inserted ? { status: "stored", id: result.id } : { status: "duplicate", id: result.id };
}

export type FetchReceived = (providerEmailId: string) => Promise<ReceivedResult>;

/** Downloads one stored message's body from Resend. Never throws for provider errors. */
export async function fetchInboundBody(
  store: EmailStore,
  fetchReceived: FetchReceived | null,
  inboundId: string
): Promise<"fetched" | "retry" | "failed" | "skipped"> {
  const row = await store.getInbound(inboundId);
  if (!row || row.body_status !== "pending") return "skipped";
  const attempts = row.body_fetch_attempts + 1;

  if (!fetchReceived) {
    await store.updateInbound(inboundId, {
      body_fetch_attempts: attempts,
      body_status: attempts >= MAX_BODY_FETCH_ATTEMPTS ? "failed" : "pending",
      body_error: "RESEND_API_KEY is not set, so the message body can't be downloaded.",
    });
    return attempts >= MAX_BODY_FETCH_ATTEMPTS ? "failed" : "retry";
  }

  const result = await fetchReceived(row.provider_email_id);
  if (!result.ok) {
    const giveUp = !result.retryable || attempts >= MAX_BODY_FETCH_ATTEMPTS;
    await store.updateInbound(inboundId, {
      body_fetch_attempts: attempts,
      body_status: giveUp ? "failed" : "pending",
      body_error: `${result.code}: ${result.message}`.slice(0, 400),
    });
    return giveUp ? "failed" : "retry";
  }

  const email = result.email;
  const text = email.text ?? null;
  const html = email.html ?? null;
  const truncated = (text?.length ?? 0) > MAX_TEXT_BODY || (html?.length ?? 0) > MAX_HTML_BODY;
  const fromHeader = parseMailbox(email.fromHeader);
  const replyTo = email.replyTo
    .map((v) => parseMailbox(v)?.address ?? null)
    .filter((v): v is string => v !== null && isValidEmail(v))
    .slice(0, 3);

  // Merge the API's attachment sizes into the webhook's metadata.
  const sizes = new Map(email.attachments.map((a) => [a.id, a.size]));
  const existing = Array.isArray(row.attachments) ? (row.attachments as unknown as InboundAttachment[]) : [];
  const attachments = existing.length
    ? existing.map((a) => ({ ...a, size: a.size ?? sizes.get(a.id) ?? null }))
    : cleanAttachments(
        email.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          content_type: a.contentType,
          size: a.size,
          content_disposition: a.contentDisposition,
        }))
      );

  await store.updateInbound(inboundId, {
    text_body: text ? text.slice(0, MAX_TEXT_BODY) : null,
    html_body: html ? html.slice(0, MAX_HTML_BODY) : null,
    body_truncated: truncated,
    body_status: "fetched",
    body_fetch_attempts: attempts,
    body_error: null,
    from_name: row.from_name ?? (fromHeader?.name ? sanitizeDisplayName(fromHeader.name, 120) : null),
    reply_to_addresses: replyTo,
    auth_spf: email.authentication.spf,
    auth_dkim: email.authentication.dkim,
    auth_dmarc: email.authentication.dmarc,
    attachments: attachments as unknown as Json,
  });
  return "fetched";
}

export async function fetchPendingInboundBodies(
  store: EmailStore,
  fetchReceived: FetchReceived | null,
  limit = 10
): Promise<number> {
  const ids = await store.listInboundIdsNeedingBody(limit, MAX_BODY_FETCH_ATTEMPTS);
  let fetched = 0;
  for (const id of ids) {
    try {
      if ((await fetchInboundBody(store, fetchReceived, id)) === "fetched") fetched += 1;
    } catch (err) {
      console.error("[email-inbound] body fetch error:", err instanceof Error ? err.message : "unknown");
    }
  }
  return fetched;
}

// ---------------------------------------------------------------------------
// Delivery events for outbound mail

const EVENT_STATUS: Record<string, EmailStatus> = {
  "email.sent": "sent",
  "email.delivery_delayed": "delivery_delayed",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};

const RANK: Partial<Record<EmailStatus, number>> = {
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  failed: 4,
  suppressed: 4,
};

export function isDeliveryEvent(type: string): boolean {
  return type in EVENT_STATUS;
}

export async function applyDeliveryEvent(
  store: EmailStore,
  type: string,
  data: unknown,
  eventCreatedAt: unknown
): Promise<"updated" | "ignored"> {
  const next = EVENT_STATUS[type];
  const d = asRecord(data);
  const providerId = d && typeof d.email_id === "string" ? d.email_id : null;
  if (!next || !providerId || !PROVIDER_ID_RE.test(providerId)) return "ignored";

  const row = await store.findMessageByProviderId(providerId);
  if (!row) return "ignored";

  const currentRank = RANK[row.status as EmailStatus] ?? 0;
  const nextRank = RANK[next] ?? 0;
  if (nextRank < currentRank || (nextRank === currentRank && row.status === next)) return "ignored";

  const at = typeof eventCreatedAt === "string" && Number.isFinite(Date.parse(eventCreatedAt))
    ? new Date(Date.parse(eventCreatedAt)).toISOString()
    : new Date().toISOString();
  await store.updateMessage(row.id, {
    status: next,
    last_event_at: at,
    last_error: nextRank === 4 && next !== "complained" ? `Resend reported: ${type.replace("email.", "")}` : row.last_error,
    updated_at: new Date().toISOString(),
  });
  return "updated";
}

/** Recipient to use when replying to a received message. */
export function replyRecipient(row: { reply_to_addresses: string[]; from_address: string }): string | null {
  const candidate = row.reply_to_addresses[0] ?? row.from_address;
  const normalized = normalizeEmail(candidate);
  return isValidEmail(normalized) ? normalized : null;
}

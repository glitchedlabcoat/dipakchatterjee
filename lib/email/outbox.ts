// lib/email/outbox.ts
//
// Delivers queued rows of public.email_messages through Resend.
//
// Life of a message:
//   pending ──claim──> sending ──Resend 2xx──> sent ──webhooks──> delivered
//      ^                  │                                      / bounced …
//      └── retryable ─────┤
//          error          └── permanent error / out of attempts ──> failed
//   skipped: never attempted (feature off, no recipient, complaint gone,
//            provider not configured, rate cap). Terminal.
//
// Duplicate protection, three layers deep:
//   1. dedupe_key is UNIQUE, so the same receipt/notification/reminder can
//      only be queued once however many times the code path runs.
//   2. claimMessage() is a compare-and-set on (status, attempts), so two
//      workers (an after() callback and the cron route) can't both send a
//      row.
//   3. Every send carries Idempotency-Key = dedupe_key with a payload
//      frozen on the first attempt, so even a retry after an ambiguous
//      failure (timeout, 5xx) is collapsed by Resend into the original
//      send. Resend keeps keys for 24 hours, so automatic retries stop
//      after RETRY_WINDOW_MS (23 h); the admin "Retry" button exists for
//      anything later.

import { SITE_URL } from "@/lib/site-url";
import { formatReferenceNumber } from "@/lib/reference";
import type { EmailMessageRow } from "@/types/domain";
import type { Json } from "@/types/database.types";
import type { OutgoingEmail, SendResult } from "@/lib/email/resend";
import type { EmailStore } from "@/lib/email/store";
import { brandNameOf, resolveSender, type EmailSettings } from "@/lib/email/settings";
import { describeSchedule } from "@/lib/email/schedule";
import { renderComplaintReceipt, renderOfficeNotification, renderReminder } from "@/lib/email/templates";

export const MAX_ATTEMPTS = 6;
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const RETRY_WINDOW_MS = 23 * 3_600_000;
export const STALE_CLAIM_MS = 10 * 60_000;
export const MAX_REMINDER_ITEMS = 50;

export type Sender = (email: OutgoingEmail, idempotencyKey: string) => Promise<SendResult>;

export type OutboxDeps = {
  store: EmailStore;
  /** null when RESEND_API_KEY isn't configured. */
  send: Sender | null;
  now?: () => Date;
  siteUrl?: string;
};

export type DeliveryOutcome =
  | { status: "sent"; providerId: string }
  | { status: "retry_scheduled"; error: string; nextAttemptAt: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string }
  | { status: "not_due" }
  | { status: "busy" }
  | { status: "missing" };

export function complaintAdminUrl(siteUrl: string, complaintId: string): string {
  return `${siteUrl}/admin/complaints?complaint=${encodeURIComponent(complaintId)}`;
}

type Content = {
  from: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string> | null;
};

function headersFromJson(value: Json | null): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : null;
}

function storedContent(row: EmailMessageRow): Content | null {
  if (!row.from_header || !row.subject || row.body_html === null || row.body_text === null) return null;
  return {
    from: row.from_header,
    replyTo: row.reply_to,
    subject: row.subject,
    html: row.body_html,
    text: row.body_text,
    headers: headersFromJson(row.extra_headers),
  };
}

type RenderOutcome = { ok: true; content: Content } | { ok: false; reason: string };

async function renderSystemMessage(
  deps: OutboxDeps,
  row: EmailMessageRow,
  settings: EmailSettings,
  now: Date
): Promise<RenderOutcome> {
  const from = resolveSender(settings);
  if (!from) return { ok: false, reason: "No sender is configured (RESEND_FROM_EMAIL is not set on the server)." };

  const brandName = brandNameOf(settings);
  const timeZone = settings.schedule.timezone;
  const siteUrl = deps.siteUrl ?? SITE_URL;

  if (row.kind === "complaint_receipt" || row.kind === "office_notification") {
    const complaint = row.complaint_id ? await deps.store.getComplaint(row.complaint_id) : null;
    if (!complaint) return { ok: false, reason: "The complaint no longer exists (it expired or was deleted)." };
    const reference = formatReferenceNumber(complaint.id);
    const submittedAt = new Date(complaint.createdAt);

    if (row.kind === "complaint_receipt") {
      const office = await deps.store.getOfficeContact();
      const r = renderComplaintReceipt({ brandName, reference, submittedAt, timeZone, office, siteUrl });
      return { ok: true, content: { from, replyTo: settings.replyTo, headers: null, ...r } };
    }

    const r = renderOfficeNotification({
      brandName,
      reference,
      submittedAt,
      timeZone,
      adminUrl: complaintAdminUrl(siteUrl, complaint.id),
      attachmentCount: complaint.attachmentCount,
      phoneProvided: complaint.phoneProvided,
      emailProvided: Boolean(complaint.contactEmail),
    });
    return { ok: true, content: { from, replyTo: null, headers: null, ...r } };
  }

  if (row.kind === "reminder") {
    const { total, items } = await deps.store.listUnresolvedComplaints(now.toISOString(), MAX_REMINDER_ITEMS);
    const r = renderReminder({
      brandName,
      total,
      now,
      timeZone,
      complaintsUrl: `${siteUrl}/admin/complaints`,
      scheduleLabel: describeSchedule(settings.schedule),
      items: items.map((c) => ({
        reference: formatReferenceNumber(c.id),
        submittedAt: new Date(c.createdAt),
        adminUrl: complaintAdminUrl(siteUrl, c.id),
      })),
    });
    return { ok: true, content: { from, replyTo: null, headers: null, ...r } };
  }

  return { ok: false, reason: "The message has no content to send." };
}

function describeFailure(result: Extract<SendResult, { ok: false }>): string {
  const base = `${result.code}: ${result.message}`;
  return result.outcomeUnknown ? `${base} (Resend may have accepted it; retries reuse the same idempotency key)` : base;
}

export async function deliverMessage(
  deps: OutboxDeps,
  id: string,
  options: { force?: boolean } = {}
): Promise<DeliveryOutcome> {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const row = await store.getMessage(id);
  if (!row) return { status: "missing" };

  const staleClaim =
    row.status === "sending" && row.claimed_at !== null && Date.parse(row.claimed_at) < nowMs - STALE_CLAIM_MS;
  const due = row.status === "pending" && (options.force || Date.parse(row.next_attempt_at) <= nowMs);
  if (!due && !staleClaim) return row.status === "sending" ? { status: "busy" } : { status: "not_due" };

  if (!deps.send) {
    const reason = "Email sending is not configured (RESEND_API_KEY is not set on the server).";
    await store.updateMessage(id, { status: "skipped", last_error: reason, updated_at: nowIso });
    return { status: "skipped", reason };
  }

  const claimed = await store.claimMessage(row, {
    status: "sending",
    claimed_at: nowIso,
    attempts: row.attempts + 1,
    first_attempt_at: row.first_attempt_at ?? nowIso,
    updated_at: nowIso,
  });
  if (!claimed) return { status: "busy" };

  const skip = async (reason: string): Promise<DeliveryOutcome> => {
    await store.updateMessage(id, { status: "skipped", last_error: reason, claimed_at: null, updated_at: nowIso });
    return { status: "skipped", reason };
  };

  if (claimed.to_addresses.length === 0) return skip("No recipient.");

  let content = storedContent(claimed);
  if (!content) {
    const settings = await store.loadSettings();
    const rendered = await renderSystemMessage(deps, claimed, settings, now);
    if (!rendered.ok) return skip(rendered.reason);
    content = rendered.content;
    // Frozen before sending, so a retry after a crash sends the same bytes.
    await store.updateMessage(id, {
      from_header: content.from,
      reply_to: content.replyTo,
      subject: content.subject,
      body_text: content.text,
      body_html: content.html,
      extra_headers: content.headers as Json,
    });
  }

  const result = await deps.send(
    {
      from: content.from,
      to: claimed.to_addresses,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: content.replyTo,
      headers: content.headers,
      tags: [{ name: "kind", value: claimed.kind }],
    },
    claimed.dedupe_key
  );

  if (result.ok) {
    await store.updateMessage(id, {
      status: "sent",
      provider_message_id: result.id,
      sent_at: nowIso,
      last_error: null,
      claimed_at: null,
      updated_at: nowIso,
    });
    return { status: "sent", providerId: result.id };
  }

  const error = describeFailure(result);
  const firstAttemptMs = Date.parse(claimed.first_attempt_at ?? nowIso);
  if (result.retryable && claimed.attempts < MAX_ATTEMPTS) {
    const backoff = BACKOFF_MS[Math.min(claimed.attempts - 1, BACKOFF_MS.length - 1)];
    const nextMs = nowMs + Math.max(backoff, result.retryAfterMs ?? 0);
    if (nextMs - firstAttemptMs <= RETRY_WINDOW_MS) {
      const nextAttemptAt = new Date(nextMs).toISOString();
      await store.updateMessage(id, {
        status: "pending",
        next_attempt_at: nextAttemptAt,
        last_error: error,
        claimed_at: null,
        updated_at: nowIso,
      });
      return { status: "retry_scheduled", error, nextAttemptAt };
    }
  }

  await store.updateMessage(id, { status: "failed", last_error: error, claimed_at: null, updated_at: nowIso });
  return { status: "failed", error };
}

/** Sends one batch of due messages (new, retry-due, or stuck in "sending"). */
export async function processDueMessages(deps: OutboxDeps, limit = 25): Promise<Record<DeliveryOutcome["status"], number>> {
  const now = deps.now?.() ?? new Date();
  const ids = await deps.store.listDueMessageIds(
    now.toISOString(),
    new Date(now.getTime() - STALE_CLAIM_MS).toISOString(),
    limit
  );
  const counts: Record<DeliveryOutcome["status"], number> = {
    sent: 0,
    retry_scheduled: 0,
    failed: 0,
    skipped: 0,
    not_due: 0,
    busy: 0,
    missing: 0,
  };
  for (const id of ids) {
    try {
      const outcome = await deliverMessage(deps, id);
      counts[outcome.status] += 1;
    } catch (err) {
      console.error("[email-outbox] delivery error:", err instanceof Error ? err.message : "unknown");
    }
  }
  return counts;
}

/** Best effort, for after(): never throws. */
export async function deliverMessages(deps: OutboxDeps, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const outcome = await deliverMessage(deps, id);
      if (outcome.status === "failed" || outcome.status === "retry_scheduled") {
        console.warn(`[email-outbox] message ${id}: ${outcome.status}`);
      }
    } catch (err) {
      console.error(`[email-outbox] message ${id}:`, err instanceof Error ? err.message : "unknown");
    }
  }
}

/** Puts a failed/skipped message back in the queue (admin "Retry"). */
export async function requeueMessage(store: EmailStore, row: EmailMessageRow, now: Date): Promise<boolean> {
  if (!["failed", "skipped"].includes(row.status)) return false;
  const claimed = await store.claimMessage(row, {
    status: "pending",
    attempts: 0,
    first_attempt_at: null,
    next_attempt_at: now.toISOString(),
    claimed_at: null,
    updated_at: now.toISOString(),
  });
  return claimed !== null;
}

// app/admin/(protected)/emails/actions.ts
//
// Server actions for Admin > Emails. Every one re-checks authorization
// itself (a server action is a public POST endpoint, whatever page shows
// the button) with requireAdmin() from lib/admin-guard.ts: any dashboard
// account (a profile with role ADMIN or USER) has full access to the
// whole Emails section, and nobody else has any. That is the same rule
// as the database's is_admin(), which the email tables' read policies
// use.
//
// They return { ok, error } objects rather than throwing: in production
// Next.js replaces a thrown server-action error's message with a generic
// one, which would hide useful feedback like "invalid recipient".
// Writes use the service-role store (the email tables have no write
// policies at all), only after the check above has passed. Activity-log
// entries record counts, never addresses or content.

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { logDashboardActivity } from "@/lib/activity-log";
import { createServiceClient } from "@/utils/supabase/admin";
import { parseAddressList } from "@/lib/email/address";
import { createEmailRuntime } from "@/lib/email/runtime";
import { deliverMessage, requeueMessage, type DeliveryOutcome } from "@/lib/email/outbox";
import { replyRecipient, cleanMessageId } from "@/lib/email/inbound";
import { renderPlainMessage, renderTestEmail, cleanSubject } from "@/lib/email/templates";
import {
  brandNameOf,
  resolveSender,
  scheduleChanged,
  validateSettingsInput,
  type EmailSettingsInput,
} from "@/lib/email/settings";
import { describeSchedule, formatInZone, nextOccurrence } from "@/lib/email/schedule";
import {
  MAX_BODY,
  MAX_RECIPIENTS,
  MAX_SUBJECT,
  MAX_TO_FIELD,
  draftRecipientsFromInput,
  draftSubjectFromInput,
  inboundTrashBlockedReason,
  messageTrashBlockedReason,
} from "@/lib/email/mailbox";
import type { EmailMessageRow } from "@/types/domain";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** "sent": Resend accepted it. "queued": durably in the Outbox, retried automatically. */
export type SendStatus = "sent" | "queued";

// Resend's free plan allows 100 emails a day in total, receipts and
// notifications included; these caps keep manual sending well inside it.
// They are shared by every administrator.
const SENDS_PER_HOUR = 20;
const SENDS_PER_DAY = 50;
const TESTS_PER_HOUR = 5;

const MIGRATION_HINT =
  "The email tables don't exist yet. Apply supabase/migrations/20261017000000_email_system.sql in the Supabase SQL editor first.";

function authError(err: unknown): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : "";
  if (message === "Unauthorized") return { ok: false, error: "Your session has expired. Please sign in again." };
  if (message === "Forbidden") return { ok: false, error: "Your account doesn't have access to the dashboard." };
  return { ok: false, error: "Something went wrong. Please try again." };
}

function storeError(err: unknown): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : "";
  console.error("[emails/actions]", message || "unknown error");
  if (/PGRST205|42P01|42703|does not exist|schema cache/i.test(message)) return { ok: false, error: MIGRATION_HINT };
  return { ok: false, error: "The database request failed. Please try again." };
}

function refreshEmails() {
  revalidatePath("/admin/emails", "layout");
}

/** Maps a delivery attempt to what the person who pressed Send is told. */
function sendOutcome(outcome: DeliveryOutcome): ActionResult<{ status: SendStatus; note?: string }> {
  switch (outcome.status) {
    case "sent":
      return { ok: true, status: "sent" };
    case "retry_scheduled":
      return {
        ok: true,
        status: "queued",
        note: `Not sent yet (${outcome.error}). It is in the Outbox and will be retried automatically.`,
      };
    case "busy":
    case "not_due":
      return { ok: true, status: "queued", note: "It is in the Outbox and is being sent." };
    case "failed":
      return { ok: false, error: `Sending failed: ${outcome.error}. The message is in the Outbox.` };
    case "skipped":
      return { ok: false, error: `${outcome.reason} The message is in the Outbox.` };
    default:
      return { ok: false, error: "The message could not be found." };
  }
}

async function enforceSendCaps(kinds: ("compose" | "reply" | "test")[], perHour: number, perDay?: number) {
  const { store } = createEmailRuntime();
  const now = Date.now();
  const [hour, day] = await Promise.all([
    store.countMessagesSince(kinds, new Date(now - 3_600_000).toISOString()),
    perDay ? store.countMessagesSince(kinds, new Date(now - 86_400_000).toISOString()) : Promise.resolve(0),
  ]);
  if (hour >= perHour) return `Sending limit reached (${perHour} per hour across all administrators). Please wait a while.`;
  if (perDay && day >= perDay) return `Daily sending limit reached (${perDay} per day across all administrators).`;
  return null;
}

const ISO_TIMESTAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+(Z|[+-][0-9:]+)?$/;
const expectedUpdatedAtSchema = z.string().max(64).regex(ISO_TIMESTAMP_RE).nullable().optional();

/** Explains why updateDraft() changed nothing. */
async function draftConflict(id: string): Promise<{ ok: false; error: string }> {
  const { store } = createEmailRuntime();
  const row = await store.getMessage(id);
  if (!row || row.kind !== "compose") return { ok: false, error: "This draft no longer exists." };
  if (row.trashed_at) return { ok: false, error: "This draft is in Trashed. Restore it to keep editing." };
  if (row.status !== "draft") return { ok: false, error: "This draft has already been sent. Check Outbox or Sent." };
  return {
    ok: false,
    error:
      "This draft was changed in another tab or by another administrator. Copy anything you need, then reload to see the latest version.",
  };
}

// ---------------------------------------------------------------------------
// Settings

export async function saveEmailSettings(
  input: EmailSettingsInput
): Promise<ActionResult<{ nextReminder: string | null; scheduleLabel: string }>> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }

  const parsed = validateSettingsInput(input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  try {
    const { store } = createEmailRuntime();
    const current = await store.loadSettings();
    const now = new Date();
    const changed = !current.persisted || scheduleChanged(current, value);

    const service = createServiceClient();
    const { error } = await service.from("email_settings").upsert(
      {
        id: "default",
        sender_name: value.senderName,
        sender_address: value.senderAddress,
        reply_to: value.replyTo,
        office_notification_email: value.officeNotificationEmail,
        citizen_confirmation_enabled: value.citizenConfirmationEnabled,
        office_notification_enabled: value.officeNotificationEnabled,
        reminders_enabled: value.remindersEnabled,
        reminder_frequency: value.schedule.frequency,
        reminder_time: value.schedule.time,
        reminder_timezone: value.schedule.timezone,
        reminder_weekday: value.schedule.weekday,
        reminder_month_day: value.schedule.monthDay,
        reminder_interval: value.schedule.interval,
        reminder_start_date: value.schedule.startDate,
        reminder_schedule_updated_at: changed ? now.toISOString() : current.scheduleUpdatedAt,
        updated_at: now.toISOString(),
        updated_by: ctx.user.id,
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(`${error.code ?? ""} ${error.message}`);

    await logDashboardActivity(ctx.supabase, ctx.user, {
      action: "UPDATE_EMAIL_SETTINGS",
      entityType: "email",
      details: "Updated email settings",
    });

    refreshEmails();
    const next = value.remindersEnabled ? nextOccurrence(value.schedule, now.getTime()) : null;
    return {
      ok: true,
      nextReminder: next === null ? null : formatInZone(next, value.schedule.timezone),
      scheduleLabel: describeSchedule(value.schedule),
    };
  } catch (err) {
    return storeError(err);
  }
}

export async function sendTestEmail(): Promise<ActionResult<{ to: string }>> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }
  const to = ctx.user.email;
  if (!to) return { ok: false, error: "Your account has no email address to send the test to." };

  try {
    const runtime = createEmailRuntime();
    if (!runtime.send) return { ok: false, error: "Set RESEND_API_KEY on the server first." };
    const cap = await enforceSendCaps(["test"], TESTS_PER_HOUR);
    if (cap) return { ok: false, error: cap };

    const settings = await runtime.store.loadSettings();
    const from = resolveSender(settings);
    if (!from) return { ok: false, error: "Set RESEND_FROM_EMAIL on the server first." };

    const now = new Date();
    const rendered = renderTestEmail({ brandName: brandNameOf(settings), sentAt: now, timeZone: settings.schedule.timezone });
    const { id } = await runtime.store.insertMessage({
      kind: "test",
      dedupeKey: `test:${randomUUID()}`,
      toAddresses: [to],
      fromHeader: from,
      replyTo: settings.replyTo,
      subject: rendered.subject,
      bodyText: rendered.text,
      bodyHtml: rendered.html,
      createdBy: ctx.user.id,
    });
    const outcome = await deliverMessage(runtime, id, { force: true });
    refreshEmails();
    if (outcome.status === "sent") return { ok: true, to };
    const result = sendOutcome(outcome);
    return result.ok ? { ok: false, error: result.note ?? "Not sent yet; check the Outbox." } : result;
  } catch (err) {
    return storeError(err);
  }
}

// ---------------------------------------------------------------------------
// Drafts and New Message

const draftSchema = z.object({
  draftId: z.uuid().nullable().optional(),
  requestId: z.uuid(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  to: z.string().max(MAX_TO_FIELD, "Too many recipients."),
  subject: z.string().max(MAX_SUBJECT * 2, `Keep the subject under ${MAX_SUBJECT} characters.`),
  body: z.string().max(MAX_BODY, `Keep the message under ${MAX_BODY.toLocaleString("en-IN")} characters.`),
});

export type DraftInput = z.input<typeof draftSchema>;

/**
 * Creates or updates a draft. Drafts live in email_messages (status
 * 'draft'), so they survive reloads, other browsers and redeploys, and
 * every administrator sees the same drafts. The To field is stored as
 * typed (an unfinished address survives); Send validates it.
 */
export async function saveDraft(input: DraftInput): Promise<ActionResult<{ draftId: string; updatedAt: string }>> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the draft and try again." };
  const { draftId, requestId, expectedUpdatedAt } = parsed.data;
  const toAddresses = draftRecipientsFromInput(parsed.data.to);
  const subject = draftSubjectFromInput(parsed.data.subject);
  const body = parsed.data.body.replace(/\r\n?/g, "\n");
  if (toAddresses.length === 0 && !subject.trim() && !body.trim()) {
    return { ok: false, error: "There's nothing to save yet." };
  }

  try {
    const { store } = createEmailRuntime();
    const nowIso = new Date().toISOString();
    const patch = { to_addresses: toAddresses, subject, body_text: body, updated_at: nowIso };

    let id = draftId ?? null;
    if (!id) {
      const inserted = await store.insertMessage({
        kind: "compose",
        // The same key becomes Resend's Idempotency-Key when it's sent.
        dedupeKey: `compose:${requestId}`,
        status: "draft",
        toAddresses,
        subject,
        bodyText: body,
        createdBy: ctx.user.id,
      });
      if (inserted.inserted) {
        const row = await store.getMessage(inserted.id);
        refreshEmails();
        return { ok: true, draftId: inserted.id, updatedAt: row?.updated_at ?? nowIso };
      }
      // A second Save before the first answered: update that same draft.
      id = inserted.id;
    }

    const row = await store.updateDraft(id, draftId ? (expectedUpdatedAt ?? null) : null, patch);
    if (!row) return draftConflict(id);
    refreshEmails();
    return { ok: true, draftId: row.id, updatedAt: row.updated_at };
  } catch (err) {
    return storeError(err);
  }
}

const composeSchema = z.object({
  requestId: z.uuid(),
  draftId: z.uuid().nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  to: z.string().max(MAX_TO_FIELD, "Too many recipients."),
  subject: z
    .string()
    .transform((v) => cleanSubject(v, MAX_SUBJECT + 1))
    .pipe(z.string().min(1, "Enter a subject.").max(MAX_SUBJECT, `Keep the subject under ${MAX_SUBJECT} characters.`)),
  body: z
    .string()
    .trim()
    .min(1, "Write a message.")
    .max(MAX_BODY, `Keep the message under ${MAX_BODY.toLocaleString("en-IN")} characters.`),
});

export type ComposeInput = z.input<typeof composeSchema>;

/**
 * Sends a new message, or a saved draft (draftId). Exactly one email per
 * composition: the row's unique dedupe_key is also Resend's
 * Idempotency-Key, and sending a draft is a compare-and-set from 'draft'
 * to 'pending', so a double-click, a retried request or two
 * administrators pressing Send at once can't send it twice.
 */
export async function sendComposedEmail(
  input: ComposeInput
): Promise<
  | ActionResult<{ status: SendStatus; id: string; recipients: number; note?: string }>
  // Resend refused it after it was queued: it's in the Outbox (failed), so
  // the composer must not send that same message again.
  | { ok: false; error: string; queuedId: string }
> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }

  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the message and try again." };
  const recipients = parseAddressList(parsed.data.to, MAX_RECIPIENTS);
  if (!recipients.ok) return recipients;

  try {
    const runtime = createEmailRuntime();
    if (!runtime.send) return { ok: false, error: "Sending isn't configured: set RESEND_API_KEY on the server first." };
    const settings = await runtime.store.loadSettings();
    const from = resolveSender(settings);
    if (!from) return { ok: false, error: "Set RESEND_FROM_EMAIL on the server first." };

    const cap = await enforceSendCaps(["compose", "reply"], SENDS_PER_HOUR, SENDS_PER_DAY);
    if (cap) return { ok: false, error: cap };

    const rendered = renderPlainMessage({ brandName: brandNameOf(settings), subject: parsed.data.subject, body: parsed.data.body });
    const nowIso = new Date().toISOString();
    const content = {
      to_addresses: recipients.addresses,
      from_header: from,
      reply_to: settings.replyTo,
      subject: rendered.subject,
      body_text: rendered.text,
      body_html: rendered.html,
    };

    let row: EmailMessageRow | null = null;
    const promote = (id: string, expected: string | null) =>
      runtime.store.updateDraft(id, expected, {
        ...content,
        status: "pending",
        queued_at: nowIso,
        next_attempt_at: nowIso,
        updated_at: nowIso,
      });

    if (parsed.data.draftId) {
      row = await promote(parsed.data.draftId, parsed.data.expectedUpdatedAt ?? null);
      if (!row) return draftConflict(parsed.data.draftId);
    } else {
      const { id, inserted } = await runtime.store.insertMessage({
        kind: "compose",
        dedupeKey: `compose:${parsed.data.requestId}`,
        toAddresses: recipients.addresses,
        fromHeader: from,
        replyTo: settings.replyTo,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        createdBy: ctx.user.id,
      });
      if (!inserted) {
        // Either a resubmission of a message already sent, or a draft saved
        // under this composition whose id the browser didn't get back.
        row = await promote(id, null);
        if (!row) return { ok: false, error: "This message was already submitted. Check Outbox or Sent." };
      } else {
        row = await runtime.store.getMessage(id);
      }
    }
    if (!row) return { ok: false, error: "The message could not be queued. Please try again." };

    const outcome = await deliverMessage(runtime, row.id, { force: true });
    await logDashboardActivity(ctx.supabase, ctx.user, {
      action: "SEND_EMAIL",
      entityType: "email",
      details: `Sent an email to ${recipients.addresses.length} recipient${recipients.addresses.length === 1 ? "" : "s"}`,
    });
    refreshEmails();
    const result = sendOutcome(outcome);
    return result.ok ? { ...result, id: row.id, recipients: recipients.addresses.length } : { ...result, queuedId: row.id };
  } catch (err) {
    return storeError(err);
  }
}

// ---------------------------------------------------------------------------
// Replies

const replySchema = z.object({
  requestId: z.uuid(),
  inboundId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write a reply.")
    .max(MAX_BODY, `Keep the reply under ${MAX_BODY.toLocaleString("en-IN")} characters.`),
});

export async function sendReply(input: {
  requestId: string;
  inboundId: string;
  body: string;
}): Promise<ActionResult<{ to: string; status: SendStatus; note?: string }>> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }

  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reply and try again." };

  try {
    const runtime = createEmailRuntime();
    if (!runtime.send) return { ok: false, error: "Sending isn't configured: set RESEND_API_KEY on the server first." };
    const inbound = await runtime.store.getInbound(parsed.data.inboundId);
    if (!inbound) return { ok: false, error: "That message no longer exists." };

    const to = replyRecipient(inbound);
    if (!to) return { ok: false, error: "This message has no valid address to reply to." };

    const settings = await runtime.store.loadSettings();
    const from = resolveSender(settings);
    if (!from) return { ok: false, error: "Set RESEND_FROM_EMAIL on the server first." };

    const cap = await enforceSendCaps(["compose", "reply"], SENDS_PER_HOUR, SENDS_PER_DAY);
    if (cap) return { ok: false, error: cap };

    const original = inbound.subject?.trim() || "(no subject)";
    const subject = /^re:/i.test(original) ? original : `Re: ${original}`;
    const messageId = cleanMessageId(inbound.message_id);
    const rendered = renderPlainMessage({ brandName: brandNameOf(settings), subject, body: parsed.data.body });

    const { id, inserted } = await runtime.store.insertMessage({
      kind: "reply",
      dedupeKey: `reply:${parsed.data.requestId}`,
      inboundId: inbound.id,
      toAddresses: [to],
      fromHeader: from,
      replyTo: settings.replyTo,
      subject: rendered.subject,
      bodyText: rendered.text,
      bodyHtml: rendered.html,
      extraHeaders: messageId ? { "In-Reply-To": messageId, References: messageId } : null,
      createdBy: ctx.user.id,
    });
    if (!inserted) return { ok: false, error: "This reply was already submitted. Check Outbox or Sent." };

    const outcome = await deliverMessage(runtime, id, { force: true });
    await logDashboardActivity(ctx.supabase, ctx.user, {
      action: "SEND_EMAIL",
      entityType: "email",
      details: "Replied to a received email",
    });
    refreshEmails();
    const result = sendOutcome(outcome);
    return result.ok ? { ...result, to } : result;
  } catch (err) {
    return storeError(err);
  }
}

// ---------------------------------------------------------------------------
// Inbox state, retries and Trashed

export async function setInboundRead(input: { id: string; isRead: boolean }): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (err) {
    return authError(err);
  }
  const parsed = z.object({ id: z.uuid(), isRead: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };

  try {
    const { store } = createEmailRuntime();
    await store.updateInbound(parsed.data.id, { is_read: parsed.data.isRead });
    refreshEmails();
    return { ok: true };
  } catch (err) {
    return storeError(err);
  }
}

export async function retryEmailMessage(input: { id: string }): Promise<ActionResult<{ status: SendStatus; note?: string }>> {
  try {
    await requireAdmin();
  } catch (err) {
    return authError(err);
  }
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };

  try {
    const runtime = createEmailRuntime();
    if (!runtime.send) return { ok: false, error: "Sending isn't configured: set RESEND_API_KEY on the server first." };
    const row = await runtime.store.getMessage(parsed.data.id);
    if (!row) return { ok: false, error: "That message no longer exists." };
    if (row.trashed_at) return { ok: false, error: "This message is in Trashed. Restore it before retrying." };
    if (!(await requeueMessage(runtime.store, row, new Date()))) {
      return { ok: false, error: "Only failed or unsent messages can be retried." };
    }
    const outcome = await deliverMessage(runtime, row.id, { force: true });
    refreshEmails();
    return sendOutcome(outcome);
  } catch (err) {
    return storeError(err);
  }
}

const trashSchema = z.object({ id: z.uuid(), type: z.enum(["message", "inbound"]) });

/** Soft delete: the row stays, with trashed_at set, and can be restored. */
export async function moveToTrash(input: { id: string; type: "message" | "inbound" }): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }
  const parsed = trashSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };

  try {
    const { store } = createEmailRuntime();
    const trash = { at: new Date().toISOString(), by: ctx.user.id };
    if (parsed.data.type === "inbound") {
      const row = await store.getInbound(parsed.data.id);
      if (!row) return { ok: false, error: "That message no longer exists." };
      const blocked = inboundTrashBlockedReason(row);
      if (blocked) return { ok: false, error: blocked };
      if (!(await store.setInboundTrash(row.id, trash))) return { ok: false, error: "That message changed. Refresh and try again." };
    } else {
      const row = await store.getMessage(parsed.data.id);
      if (!row) return { ok: false, error: "That message no longer exists." };
      const blocked = messageTrashBlockedReason(row);
      if (blocked) return { ok: false, error: blocked };
      // Re-checked in the update itself, so a message that started sending
      // in the meantime stays where it is.
      if (!(await store.setMessageTrash(row.id, trash))) {
        return { ok: false, error: "That message changed (it may be sending now). Refresh and try again." };
      }
    }
    await logDashboardActivity(ctx.supabase, ctx.user, {
      action: "TRASH_EMAIL",
      entityType: "email",
      details: parsed.data.type === "inbound" ? "Moved a received email to Trashed" : "Moved an email to Trashed",
    });
    refreshEmails();
    return { ok: true };
  } catch (err) {
    return storeError(err);
  }
}

export async function restoreFromTrash(input: { id: string; type: "message" | "inbound" }): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    return authError(err);
  }
  const parsed = trashSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };

  try {
    const { store } = createEmailRuntime();
    const row =
      parsed.data.type === "inbound"
        ? await store.setInboundTrash(parsed.data.id, null)
        : await store.setMessageTrash(parsed.data.id, null);
    if (!row) return { ok: false, error: "That message isn't in Trashed any more." };
    await logDashboardActivity(ctx.supabase, ctx.user, {
      action: "RESTORE_EMAIL",
      entityType: "email",
      details: parsed.data.type === "inbound" ? "Restored a received email" : "Restored an email",
    });
    refreshEmails();
    return { ok: true };
  } catch (err) {
    return storeError(err);
  }
}

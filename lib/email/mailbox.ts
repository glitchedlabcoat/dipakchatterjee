// lib/email/mailbox.ts
//
// The admin Emails sections as rules over the two email tables, kept in
// one place so the pages, the server actions and the tests agree:
//
//   Inbox    email_inbound rows that aren't trashed
//   Drafts   an administrator's composed message, saved but not sent
//            (kind 'compose', status 'draft')
//   Outbox   an administrator's own messages (compose, reply, test) that
//            Resend hasn't accepted yet: queued, sending, failed, not sent
//   Sent     the same kinds once Resend accepted them (sent_at is set),
//            whatever the delivery events said afterwards (delivered,
//            bounced, ...)
//   Trashed  anything with trashed_at set; restoring clears it, and
//            nothing in the UI deletes a row
//
// System emails (citizen receipts, new-complaint notifications,
// reminders) never appear in these sections. They stay in Settings >
// System email history, so transactional complaint mail and manual mail
// don't mix.
//
// No server-only imports: the composer (a client component) shares the
// limits below.

import type { EmailInboundRow, EmailMessageRow } from "@/types/domain";

export const MAILBOX_KINDS = ["compose", "reply", "test"] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];

export const SYSTEM_KINDS = ["complaint_receipt", "office_notification", "reminder"] as const;

/** Statuses of a mailbox message that Resend hasn't accepted (sent_at is null). */
export const OUTBOX_STATUSES = ["pending", "sending", "failed", "skipped"] as const;

export const MAX_RECIPIENTS = 10;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 20_000;
/** Raw text of the To field while drafting; addresses are validated on Send. */
export const MAX_TO_FIELD = 2000;
export const MAX_DRAFT_RECIPIENT_ENTRIES = 50;

export type MessageFolder = "drafts" | "outbox" | "sent" | "trash" | "system";

export function isMailboxKind(kind: string): kind is MailboxKind {
  return (MAILBOX_KINDS as readonly string[]).includes(kind);
}

export function folderOf(row: Pick<EmailMessageRow, "kind" | "status" | "sent_at" | "trashed_at">): MessageFolder {
  if (!isMailboxKind(row.kind)) return "system";
  if (row.trashed_at) return "trash";
  if (row.status === "draft") return "drafts";
  if (row.sent_at) return "sent";
  return "outbox";
}

/**
 * Why a message can't go to Trashed, or null if it can. A message the
 * outbox is still working on (queued for a retry, or being sent right
 * now) stays put: trashing it would not stop the send.
 */
export function messageTrashBlockedReason(row: Pick<EmailMessageRow, "kind" | "status" | "trashed_at">): string | null {
  if (!isMailboxKind(row.kind)) return "System emails can't be moved to Trashed.";
  if (row.trashed_at) return "This message is already in Trashed.";
  if (row.status === "pending" || row.status === "sending") {
    return "This message is still being sent. Wait until it is sent or has failed, then move it to Trashed.";
  }
  return null;
}

export function inboundTrashBlockedReason(row: Pick<EmailInboundRow, "trashed_at">): string | null {
  return row.trashed_at ? "This message is already in Trashed." : null;
}

/**
 * The To field of a draft as stored: split on commas, semicolons and line
 * breaks, trimmed, bounded. Entries aren't validated here, so an
 * unfinished address survives a save; Send validates every one.
 */
export function draftRecipientsFromInput(raw: string): string[] {
  return raw
    .slice(0, MAX_TO_FIELD)
    .split(/[,;\n\r]+/)
    .map((entry) => entry.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 320))
    .filter(Boolean)
    .slice(0, MAX_DRAFT_RECIPIENT_ENTRIES);
}

export function draftRecipientsToInput(addresses: string[]): string {
  return addresses.join(", ");
}

/** A draft's subject as stored: control characters removed, bounded. Send cleans it again. */
export function draftSubjectFromInput(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, MAX_SUBJECT);
}

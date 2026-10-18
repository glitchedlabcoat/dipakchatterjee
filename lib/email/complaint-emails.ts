// lib/email/complaint-emails.ts
//
// Queues the two emails a new complaint can trigger, separately and
// independently:
//   * Feature B: the office notification, to the recipient set in Admin >
//     Emails > Settings (whenever notifications are on);
//   * Feature A: the citizen's receipt, only if they gave an email
//     address and receipts are on.
//
// Called by submitComplaint() after the complaint row is saved. It never
// throws: any failure here is logged and swallowed, because the complaint
// is already stored and the citizen already has their reference number.
// The returned ids are delivered right after the response (after()), and
// anything that fails there is retried by the scheduled dispatch.
//
// Anti-abuse: the form is public, so a receipt is capped per address
// (RECEIPTS_PER_ADDRESS_PER_DAY) and overall (RECEIPTS_PER_HOUR). A
// capped receipt is logged as "skipped" rather than silently dropped.

import type { EmailStore } from "@/lib/email/store";

export const RECEIPTS_PER_ADDRESS_PER_DAY = 3;
export const RECEIPTS_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

export function receiptDedupeKey(complaintId: string): string {
  return `complaint-receipt:${complaintId}`;
}

export function officeNotificationDedupeKey(complaintId: string): string {
  return `office-notification:${complaintId}`;
}

function logError(context: string, err: unknown) {
  console.error(`[complaint-emails] ${context}:`, err instanceof Error ? err.message : "unknown error");
}

export type QueuedComplaintEmails = {
  /** Message ids to deliver now. */
  ids: string[];
  receiptQueued: boolean;
};

export async function queueComplaintEmails(
  store: EmailStore,
  input: { complaintId: string; contactEmail: string | null },
  now: Date = new Date()
): Promise<QueuedComplaintEmails> {
  const ids: string[] = [];
  let receiptQueued = false;

  let settings;
  try {
    settings = await store.loadSettings();
  } catch (err) {
    logError("could not load email settings", err);
    return { ids, receiptQueued };
  }

  if (settings.officeNotificationEnabled) {
    try {
      const recipient = settings.officeNotificationEmail;
      const result = await store.insertMessage({
        kind: "office_notification",
        dedupeKey: officeNotificationDedupeKey(input.complaintId),
        complaintId: input.complaintId,
        toAddresses: recipient ? [recipient] : [],
        status: recipient ? "pending" : "skipped",
        lastError: recipient ? null : "No notification recipient is set (Admin > Emails > Settings).",
      });
      if (result.inserted && recipient) ids.push(result.id);
    } catch (err) {
      logError("could not queue the office notification", err);
    }
  }

  if (input.contactEmail && settings.citizenConfirmationEnabled) {
    try {
      const address = input.contactEmail.toLowerCase();
      const [forAddress, lastHour] = await Promise.all([
        store.countMessagesSince(["complaint_receipt"], new Date(now.getTime() - 24 * HOUR_MS).toISOString(), address),
        store.countMessagesSince(["complaint_receipt"], new Date(now.getTime() - HOUR_MS).toISOString()),
      ]);
      const capped =
        forAddress >= RECEIPTS_PER_ADDRESS_PER_DAY
          ? `Not sent: ${RECEIPTS_PER_ADDRESS_PER_DAY} receipts already went to this address in the last 24 hours.`
          : lastHour >= RECEIPTS_PER_HOUR
            ? `Not sent: more than ${RECEIPTS_PER_HOUR} receipts in the last hour (anti-abuse cap).`
            : null;

      const result = await store.insertMessage({
        kind: "complaint_receipt",
        dedupeKey: receiptDedupeKey(input.complaintId),
        complaintId: input.complaintId,
        toAddresses: [address],
        status: capped ? "skipped" : "pending",
        lastError: capped,
      });
      if (result.inserted && !capped) {
        ids.push(result.id);
        receiptQueued = true;
      }
    } catch (err) {
      logError("could not queue the citizen receipt", err);
    }
  }

  return { ids, receiptQueued };
}

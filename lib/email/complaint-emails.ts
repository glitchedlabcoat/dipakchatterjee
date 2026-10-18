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
// (RECEIPTS_PER_ADDRESS_PER_DAY) and overall (RECEIPTS_PER_HOUR), office
// notifications are capped per hour (OFFICE_NOTIFICATIONS_PER_HOUR), and
// the two together per day (COMPLAINT_EMAILS_PER_DAY). A flood of
// complaints therefore can't flood the office's inbox, or use up the
// Resend quota the administrators' own email depends on. A capped email is
// logged as "skipped" (Settings > System email history) rather than
// silently dropped; the complaint itself is always saved.

import type { EmailKind, EmailStore } from "@/lib/email/store";

export const RECEIPTS_PER_ADDRESS_PER_DAY = 3;
export const RECEIPTS_PER_HOUR = 20;
export const OFFICE_NOTIFICATIONS_PER_HOUR = 30;
// Half of Resend's free plan (100 emails a day). The other half is left for
// the administrators' own sending, capped at 50 a day in
// app/admin/(protected)/emails/actions.ts.
export const COMPLAINT_EMAILS_PER_DAY = 50;

const COMPLAINT_EMAIL_KINDS: EmailKind[] = ["complaint_receipt", "office_notification"];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DAILY_CAP_REASON = `Not sent: ${COMPLAINT_EMAILS_PER_DAY} complaint emails (receipts and office notifications) already went out in the last 24 hours (anti-abuse cap).`;

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
  const since = (ms: number) => new Date(now.getTime() - ms).toISOString();

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
      let skipped: string | null = "No notification recipient is set (Admin > Emails > Settings).";
      if (recipient) {
        const [lastHour, lastDay] = await Promise.all([
          store.countMessagesSince(["office_notification"], since(HOUR_MS)),
          store.countMessagesSince(COMPLAINT_EMAIL_KINDS, since(DAY_MS)),
        ]);
        skipped =
          lastHour >= OFFICE_NOTIFICATIONS_PER_HOUR
            ? `Not sent: ${OFFICE_NOTIFICATIONS_PER_HOUR} office notifications already went out in the last hour (anti-abuse cap). The complaint is saved in Complaints.`
            : lastDay >= COMPLAINT_EMAILS_PER_DAY
              ? DAILY_CAP_REASON
              : null;
      }

      const result = await store.insertMessage({
        kind: "office_notification",
        dedupeKey: officeNotificationDedupeKey(input.complaintId),
        complaintId: input.complaintId,
        toAddresses: recipient ? [recipient] : [],
        status: skipped ? "skipped" : "pending",
        lastError: skipped,
      });
      if (result.inserted && !skipped) ids.push(result.id);
    } catch (err) {
      logError("could not queue the office notification", err);
    }
  }

  if (input.contactEmail && settings.citizenConfirmationEnabled) {
    try {
      const address = input.contactEmail.toLowerCase();
      const [forAddress, lastHour, lastDay] = await Promise.all([
        store.countMessagesSince(["complaint_receipt"], since(DAY_MS), address),
        store.countMessagesSince(["complaint_receipt"], since(HOUR_MS)),
        store.countMessagesSince(COMPLAINT_EMAIL_KINDS, since(DAY_MS)),
      ]);
      const capped =
        forAddress >= RECEIPTS_PER_ADDRESS_PER_DAY
          ? `Not sent: ${RECEIPTS_PER_ADDRESS_PER_DAY} receipts already went to this address in the last 24 hours.`
          : lastHour >= RECEIPTS_PER_HOUR
            ? `Not sent: more than ${RECEIPTS_PER_HOUR} receipts in the last hour (anti-abuse cap).`
            : lastDay >= COMPLAINT_EMAILS_PER_DAY
              ? DAILY_CAP_REASON
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

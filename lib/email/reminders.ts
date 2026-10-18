// lib/email/reminders.ts
//
// Feature C. Decides whether a scheduler run should queue a reminder, and
// queues at most one per scheduled occurrence: the occurrence's UTC
// instant is part of the dedupe key, so however many times (or however
// concurrently) the scheduler fires, one occurrence = one email.
//
// The reminder's content (which complaints are unresolved) is worked out
// when it's sent, from the same rules as the admin list: status is not
// 'resolved', not flagged expired, and expires_at is still in the future.

import type { EmailStore } from "@/lib/email/store";
import type { EmailSettings } from "@/lib/email/settings";
import { dueOccurrence } from "@/lib/email/schedule";

export type ReminderRunResult =
  | { status: "disabled" }
  | { status: "not_due" }
  | { status: "no_recipient"; occurrence: string }
  | { status: "already_queued"; occurrence: string; id: string }
  | { status: "queued"; occurrence: string; id: string };

export function reminderDedupeKey(occurrenceIso: string): string {
  return `reminder:${occurrenceIso}`;
}

export async function queueDueReminder(store: EmailStore, settings: EmailSettings, now: Date): Promise<ReminderRunResult> {
  if (!settings.persisted || !settings.remindersEnabled) return { status: "disabled" };

  const notBefore = Date.parse(settings.scheduleUpdatedAt);
  const due = dueOccurrence(settings.schedule, now.getTime(), Number.isFinite(notBefore) ? notBefore : now.getTime());
  if (due === null) return { status: "not_due" };

  const occurrence = new Date(due).toISOString();
  const recipient = settings.officeNotificationEmail;
  const result = await store.insertMessage({
    kind: "reminder",
    dedupeKey: reminderDedupeKey(occurrence),
    toAddresses: recipient ? [recipient] : [],
    status: recipient ? "pending" : "skipped",
    lastError: recipient ? null : "No notification recipient is set (Admin > Emails > Settings).",
  });

  if (!recipient) return { status: "no_recipient", occurrence };
  return result.inserted
    ? { status: "queued", occurrence, id: result.id }
    : { status: "already_queued", occurrence, id: result.id };
}

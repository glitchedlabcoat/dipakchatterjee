// lib/email/dispatch.ts
//
// One scheduler tick, run by /api/cron/email. Safe to call as often as
// the scheduler likes (every 15 minutes is the documented cadence) and
// concurrently: every step is idempotent.
//   1. queue the reminder for the current occurrence, if one is due;
//   2. send everything due: new messages, retries, and rows stuck in
//      "sending" by a restart;
//   3. download bodies of received mail that the webhook couldn't fetch;
//   4. retention: delete finished system emails (receipts,
//      notifications, reminders, tests) after 90 days, and an
//      administrator's sent messages and replies, like received mail,
//      after 365 days. Drafts and rows still being sent are never
//      deleted, and moving something to Trashed doesn't shorten its life
//      (rows about a complaint are already deleted with the complaint);
//   5. record the run, so Settings can warn if the scheduler stops.
// Each step is isolated: one failing never stops the others.

import type { EmailStore } from "@/lib/email/store";
import { processDueMessages, type DeliveryOutcome, type OutboxDeps } from "@/lib/email/outbox";
import { queueDueReminder, type ReminderRunResult } from "@/lib/email/reminders";
import { fetchPendingInboundBodies, type FetchReceived } from "@/lib/email/inbound";

export const MESSAGE_RETENTION_DAYS = 90;
export const CORRESPONDENCE_RETENTION_DAYS = 365;
export const INBOUND_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DispatchDeps = OutboxDeps & { fetchReceived: FetchReceived | null };

export type DispatchReport = {
  reminder: ReminderRunResult | null;
  outbox: Record<DeliveryOutcome["status"], number> | null;
  inboundBodiesFetched: number;
  purged: { messages: number; inbound: number } | null;
  errors: string[];
};

async function step<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    errors.push(name);
    console.error(`[email-dispatch] ${name} failed:`, err instanceof Error ? err.message : "unknown");
    return null;
  }
}

export async function runEmailDispatch(deps: DispatchDeps): Promise<DispatchReport> {
  const now = deps.now?.() ?? new Date();
  const errors: string[] = [];
  const store: EmailStore = deps.store;

  const settings = await step("settings", errors, () => store.loadSettings());
  const reminder = settings ? await step("reminder", errors, () => queueDueReminder(store, settings, now)) : null;
  const outbox = await step("outbox", errors, () => processDueMessages(deps));
  const inbound = await step("inbound", errors, () => fetchPendingInboundBodies(store, deps.fetchReceived));
  const purged = await step("retention", errors, () =>
    store.purgeOlderThan({
      systemBefore: new Date(now.getTime() - MESSAGE_RETENTION_DAYS * DAY_MS).toISOString(),
      correspondenceBefore: new Date(now.getTime() - CORRESPONDENCE_RETENTION_DAYS * DAY_MS).toISOString(),
      inboundBefore: new Date(now.getTime() - INBOUND_RETENTION_DAYS * DAY_MS).toISOString(),
    })
  );
  if (settings?.persisted) await step("heartbeat", errors, () => store.markSchedulerRun(now.toISOString()));

  return { reminder, outbox, inboundBodiesFetched: inbound ?? 0, purged, errors };
}

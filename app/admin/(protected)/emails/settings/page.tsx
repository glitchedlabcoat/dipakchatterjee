// app/admin/(protected)/emails/settings/page.tsx
//
// Email settings, provider status, scheduler health, a test email, and
// the delivery history of system emails (citizen receipts, new-complaint
// notifications, reminders) with retry. An administrator's own messages
// are in Outbox and Sent instead. Every dashboard administrator can use
// all of it (saveEmailSettings checks requireAdmin() again). Secrets are
// never shown: only whether each environment variable is set.

import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getProviderStatus } from "@/lib/email/config";
import { maskEmail } from "@/lib/email/address";
import { SYSTEM_KINDS } from "@/lib/email/mailbox";
import { settingsFromRow } from "@/lib/email/settings";
import { describeSchedule, formatInZone, listTimeZones, nextOccurrence } from "@/lib/email/schedule";
import EmailsHeader from "../EmailsHeader";
import { KIND_LABELS, MigrationNotice, Notice, StatusBadge, formatWhen, isMissingTable } from "../shared";
import EmailSettingsForm from "./EmailSettingsForm";
import TestEmailButton from "./TestEmailButton";
import RetryButton from "./RetryButton";

export const metadata: Metadata = {
  title: "Email settings - Emails | Dipak Chatterjee",
};

const PROBLEM_STATUSES = ["failed", "bounced", "complained", "suppressed", "skipped", "delivery_delayed"];
const SCHEDULER_STALE_MS = 2 * 60 * 60 * 1000;

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-forest mt-0.5 shrink-0" aria-label="Set" />
      ) : (
        <CircleAlert className="w-4 h-4 text-saffron-600 mt-0.5 shrink-0" aria-label="Not set" />
      )}
      <span>
        <span className="font-medium text-navy-900">{label}</span>
        <span className="text-ink-600"> &mdash; {detail}</span>
      </span>
    </li>
  );
}

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const problemsOnly = show === "problems";

  const supabase = await createClient();
  const provider = getProviderStatus();

  let historyQuery = supabase
    .from("email_messages")
    .select("id, kind, status, to_addresses, subject, created_at, sent_at, last_event_at, attempts, last_error")
    .in("kind", [...SYSTEM_KINDS])
    .order("created_at", { ascending: false })
    .limit(50);
  if (problemsOnly) historyQuery = historyQuery.in("status", PROBLEM_STATUSES);

  const [{ data: row, error: settingsError }, { data: history }] = await Promise.all([
    supabase.from("email_settings").select("*").eq("id", "default").maybeSingle(),
    historyQuery,
  ]);

  const missing = isMissingTable(settingsError);
  const settings = settingsFromRow(row ?? null);
  const now = new Date().getTime();
  const next = settings.remindersEnabled ? nextOccurrence(settings.schedule, now) : null;
  const lastRun = settings.schedulerLastRunAt ? Date.parse(settings.schedulerLastRunAt) : null;
  const schedulerHealthy = lastRun !== null && now - lastRun < SCHEDULER_STALE_MS;

  return (
    <div>
      <EmailsHeader
        active="settings"
        title="Email settings"
        description="Who emails come from and go to, the reminder schedule, and the history of system emails."
      />

      {missing && <MigrationNotice />}

      <div className="bg-white border border-line rounded-xl p-6 md:p-8 mb-6">
        <p className="text-sm font-semibold text-navy-900 mb-3">Provider status</p>
        <ul className="space-y-2">
          <StatusRow
            ok={provider.apiKeyConfigured}
            label="Resend API key"
            detail={provider.apiKeyConfigured ? "set on the server (never shown here)" : "RESEND_API_KEY is not set on Render"}
          />
          <StatusRow
            ok={Boolean(provider.defaultSender)}
            label="Default sender"
            detail={
              provider.defaultSender
                ? `${provider.defaultSender} (verified domain @${provider.verifiedDomain})`
                : "RESEND_FROM_EMAIL is not set on Render"
            }
          />
          <StatusRow
            ok={schedulerHealthy}
            label="Scheduler"
            detail={
              !provider.cronConfigured
                ? "CRON_SECRET is not set, so reminders and automatic retries can't run"
                : lastRun === null
                  ? "has never run; set up the scheduled call to /api/cron/email"
                  : `last ran ${formatWhen(settings.schedulerLastRunAt)}${schedulerHealthy ? "" : " (over 2 hours ago)"}`
            }
          />
          <StatusRow
            ok={provider.webhookConfigured}
            label="Delivery reports & inbox"
            detail={
              provider.webhookConfigured
                ? "Resend webhook secret is set"
                : "RESEND_WEBHOOK_SECRET is not set, so delivery confirmations and received mail don't arrive"
            }
          />
        </ul>
        {provider.apiKeyConfigured && provider.defaultSender && !missing && (
          <div className="mt-5 pt-5 border-t border-line">
            <TestEmailButton />
          </div>
        )}
      </div>

      {settings.remindersEnabled && !schedulerHealthy && !missing && (
        <Notice tone="warn" title="Reminders are on, but the scheduler isn't running">
          <p>
            Reminders and automatic retries only happen when something calls{" "}
            <code className="text-xs">/api/cron/email</code> regularly. See the setup notes in{" "}
            <code className="text-xs">docs/email-system.md</code>.
          </p>
        </Notice>
      )}

      <div className="bg-white border border-line rounded-xl p-6 md:p-8 mb-8">
        <EmailSettingsForm
          initial={settings}
          canEdit={!missing}
          verifiedDomain={provider.verifiedDomain}
          defaultSender={provider.defaultSender}
          timeZones={listTimeZones()}
          initialNextReminder={next === null ? null : formatInZone(next, settings.schedule.timezone)}
          initialScheduleLabel={describeSchedule(settings.schedule)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-navy-900">System email history</p>
        <div className="flex gap-1.5">
          <Link
            href="/admin/emails/settings"
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${
              !problemsOnly ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600"
            }`}
          >
            All
          </Link>
          <Link
            href="/admin/emails/settings?show=problems"
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${
              problemsOnly ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600"
            }`}
          >
            Problems only
          </Link>
        </div>
      </div>

      {!history || history.length === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-8 text-center text-sm text-ink-400">
          {problemsOnly ? "No failed or skipped emails." : "No emails yet."}
        </div>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line">
          {history.map((m) => {
            // Citizens' addresses are masked here; the full address stays in
            // the complaint itself.
            const recipients =
              m.kind === "complaint_receipt" ? m.to_addresses.map(maskEmail) : m.to_addresses;
            const canRetry = m.status === "failed" || m.status === "skipped";
            return (
              <li key={m.id} className="px-4 md:px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={m.status} />
                  <span className="text-sm font-medium text-navy-900">{KIND_LABELS[m.kind] ?? m.kind}</span>
                  <span className="text-xs text-ink-400 ml-auto">{formatWhen(m.created_at)}</span>
                </div>
                <p className="text-xs text-ink-600 mt-1 break-all">
                  {recipients.length ? `To ${recipients.join(", ")}` : "No recipient"}
                  {m.subject ? ` · ${m.subject}` : ""}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                  {m.sent_at ? ` · accepted ${formatWhen(m.sent_at)}` : ""}
                  {m.last_event_at ? ` · last update ${formatWhen(m.last_event_at)}` : ""}
                </p>
                {m.last_error && <p className="text-xs text-rust mt-1 break-words">{m.last_error}</p>}
                {canRetry && <RetryButton id={m.id} />}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-ink-400 mt-3">
        Citizen receipts, new-complaint notifications and reminders; the latest 50. Your own messages and test emails are in
        Outbox and Sent. Emails about a complaint are deleted with the complaint; other system emails after 90 days. Failed
        sends are retried automatically for up to 23 hours (while the scheduler runs).
      </p>
    </div>
  );
}

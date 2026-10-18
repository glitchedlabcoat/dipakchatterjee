// app/admin/(protected)/emails/settings/EmailSettingsForm.tsx
//
// The owner's email settings. Every rule is enforced again on the server
// (validateSettingsInput in lib/email/settings.ts); the checks here only
// give faster feedback. The "Next reminder" preview runs the same pure
// schedule maths as the scheduler, after hydration (it depends on now).

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { useHydrated } from "@/lib/hooks/useHydrated";
import type { EmailSettings } from "@/lib/email/settings";
import {
  INTERVAL_LIMITS,
  describeSchedule,
  formatInZone,
  nextOccurrenceFromNow,
  validateSchedule,
  type ReminderFrequency,
  type ReminderSchedule,
} from "@/lib/email/schedule";
import { saveEmailSettings } from "../actions";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const FREQUENCIES: { value: ReminderFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "every_n_days", label: "Every few days" },
  { value: "every_n_months", label: "Every few months" },
];

const inputClass =
  "w-full rounded-md border border-line bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-400 focus:border-saffron focus:outline-none disabled:bg-paper-100";
const labelClass = "block text-sm font-medium text-navy-900 mb-1.5";
const helpClass = "text-xs text-ink-400 mt-1.5";

function Toggle({
  id,
  checked,
  onChange,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 shrink-0 rounded border-line"
      />
      <span>
        <span className="block text-sm font-medium text-navy-900">{label}</span>
        <span className="block text-xs text-ink-400 mt-0.5">{help}</span>
      </span>
    </label>
  );
}

export default function EmailSettingsForm({
  initial,
  canEdit,
  verifiedDomain,
  defaultSender,
  timeZones,
  initialNextReminder,
  initialScheduleLabel,
}: {
  initial: EmailSettings;
  canEdit: boolean;
  verifiedDomain: string | null;
  defaultSender: string | null;
  timeZones: string[];
  initialNextReminder: string | null;
  initialScheduleLabel: string;
}) {
  const router = useRouter();
  const mounted = useHydrated();
  const [senderName, setSenderName] = useState(initial.senderName ?? "");
  const [senderAddress, setSenderAddress] = useState(initial.senderAddress ?? "");
  const [replyTo, setReplyTo] = useState(initial.replyTo ?? "");
  const [recipient, setRecipient] = useState(initial.officeNotificationEmail ?? "");
  const [citizenOn, setCitizenOn] = useState(initial.citizenConfirmationEnabled);
  const [officeOn, setOfficeOn] = useState(initial.officeNotificationEnabled);
  const [remindersOn, setRemindersOn] = useState(initial.remindersEnabled);
  const [schedule, setSchedule] = useState<ReminderSchedule>(initial.schedule);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const zones = useMemo(
    () => (timeZones.includes(schedule.timezone) ? timeZones : [schedule.timezone, ...timeZones]),
    [timeZones, schedule.timezone]
  );

  const preview = useMemo(() => {
    if (!mounted) return { label: initialScheduleLabel, next: initialNextReminder, error: null as string | null };
    const check = validateSchedule(schedule);
    if (!check.ok) return { label: "", next: null, error: check.error };
    const next = nextOccurrenceFromNow(schedule);
    return {
      label: describeSchedule(schedule),
      next: next === null ? null : formatInZone(next, schedule.timezone),
      error: null,
    };
  }, [mounted, schedule, initialScheduleLabel, initialNextReminder]);

  function update<K extends keyof ReminderSchedule>(key: K, value: ReminderSchedule[K]) {
    setSaved(false);
    setSchedule((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveEmailSettings({
        senderName,
        senderAddress,
        replyTo,
        officeNotificationEmail: recipient,
        citizenConfirmationEnabled: citizenOn,
        officeNotificationEnabled: officeOn,
        remindersEnabled: remindersOn,
        schedule,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const intervalLimits =
    schedule.frequency === "every_n_months" ? INTERVAL_LIMITS.every_n_months : INTERVAL_LIMITS.every_n_days;

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!canEdit || isPending} className="space-y-8">
        <section className="space-y-4">
          <p className="text-sm font-semibold text-navy-900">Sender</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sender-name" className={labelClass}>
                Sender name
              </label>
              <input
                id="sender-name"
                value={senderName}
                maxLength={80}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Dipak Chatterjee"
                className={inputClass}
              />
              <p className={helpClass}>Shown as the &ldquo;From&rdquo; name.</p>
            </div>
            <div>
              <label htmlFor="sender-address" className={labelClass}>
                Sender address
              </label>
              <input
                id="sender-address"
                type="email"
                value={senderAddress}
                maxLength={254}
                onChange={(e) => setSenderAddress(e.target.value)}
                placeholder={defaultSender ?? (verifiedDomain ? `office@${verifiedDomain}` : "")}
                className={inputClass}
              />
              <p className={helpClass}>
                {verifiedDomain
                  ? `Must end in @${verifiedDomain}. Leave blank to use ${defaultSender ?? "the server default"}.`
                  : "Set RESEND_FROM_EMAIL on the server first."}
              </p>
            </div>
          </div>
          <div>
            <label htmlFor="reply-to" className={labelClass}>
              Reply-to address <span className="text-ink-400 font-normal">(optional)</span>
            </label>
            <input
              id="reply-to"
              type="email"
              value={replyTo}
              maxLength={254}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="Leave blank to receive replies at the sender address"
              className={inputClass}
            />
            <p className={helpClass}>Where a citizen&apos;s reply to their receipt (or to your messages) goes.</p>
          </div>
        </section>

        <section className="space-y-4">
          <p className="text-sm font-semibold text-navy-900">Complaint emails</p>
          <div>
            <label htmlFor="recipient" className={labelClass}>
              Notification recipient
            </label>
            <input
              id="recipient"
              type="email"
              value={recipient}
              maxLength={254}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Mr. Dipak's email address"
              className={inputClass}
            />
            <p className={helpClass}>Receives new-complaint notifications and reminders.</p>
          </div>
          <Toggle
            id="office-on"
            checked={officeOn}
            onChange={setOfficeOn}
            label="Notify the office about every new complaint"
            help="Reference number, time and a dashboard link only. Never the complaint's details."
          />
          <Toggle
            id="citizen-on"
            checked={citizenOn}
            onChange={setCitizenOn}
            label="Email citizens a receipt"
            help="Only when they enter an email address. Contains the reference number and submission time."
          />
        </section>

        <section className="space-y-4">
          <p className="text-sm font-semibold text-navy-900">Reminders about unresolved complaints</p>
          <Toggle
            id="reminders-on"
            checked={remindersOn}
            onChange={(v) => {
              setSaved(false);
              setRemindersOn(v);
            }}
            label="Send reminders"
            help="Lists complaints not yet marked resolved (and not expired). Sent to the notification recipient."
          />

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="frequency" className={labelClass}>
                How often
              </label>
              <select
                id="frequency"
                value={schedule.frequency}
                onChange={(e) => update("frequency", e.target.value as ReminderFrequency)}
                className={inputClass}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="time" className={labelClass}>
                Time
              </label>
              <input
                id="time"
                type="time"
                step={60}
                value={schedule.time}
                onChange={(e) => update("time", e.target.value.slice(0, 5))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="timezone" className={labelClass}>
                Time zone
              </label>
              <select
                id="timezone"
                value={schedule.timezone}
                onChange={(e) => update("timezone", e.target.value)}
                className={inputClass}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {schedule.frequency === "weekly" && (
            <div className="max-w-xs">
              <label htmlFor="weekday" className={labelClass}>
                Day of the week
              </label>
              <select
                id="weekday"
                value={schedule.weekday}
                onChange={(e) => update("weekday", Number(e.target.value))}
                className={inputClass}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {schedule.frequency === "monthly" && (
            <div className="max-w-xs">
              <label htmlFor="month-day" className={labelClass}>
                Day of the month
              </label>
              <input
                id="month-day"
                type="number"
                min={1}
                max={31}
                value={schedule.monthDay}
                onChange={(e) => update("monthDay", Number(e.target.value))}
                className={inputClass}
              />
              <p className={helpClass}>In shorter months, days 29&ndash;31 fall on the month&apos;s last day.</p>
            </div>
          )}

          {(schedule.frequency === "every_n_days" || schedule.frequency === "every_n_months") && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="interval" className={labelClass}>
                  Every how many {schedule.frequency === "every_n_days" ? "days" : "months"}
                </label>
                <input
                  id="interval"
                  type="number"
                  min={intervalLimits.min}
                  max={intervalLimits.max}
                  value={schedule.interval}
                  onChange={(e) => update("interval", Number(e.target.value))}
                  className={inputClass}
                />
                <p className={helpClass}>
                  {intervalLimits.min}&ndash;{intervalLimits.max}.
                </p>
              </div>
              <div>
                <label htmlFor="start-date" className={labelClass}>
                  Starting on
                </label>
                <input
                  id="start-date"
                  type="date"
                  value={schedule.startDate}
                  onChange={(e) => update("startDate", e.target.value)}
                  className={inputClass}
                />
                {schedule.frequency === "every_n_months" && (
                  <p className={helpClass}>Repeats on this day of the month (or the last day of shorter months).</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-paper-100 border border-line px-4 py-3 text-sm text-ink-600" aria-live="polite">
            {preview.error ? (
              <span className="text-rust">{preview.error}</span>
            ) : (
              <>
                <span className="block">{preview.label}.</span>
                <span className="block mt-0.5">
                  {remindersOn
                    ? preview.next
                      ? `Next reminder: ${preview.next}.`
                      : "No upcoming reminder in the next two years."
                    : "Reminders are off."}
                </span>
              </>
            )}
            <span className="block text-xs text-ink-400 mt-1">
              Changing the schedule never sends a reminder for a time that has already passed.
            </span>
          </div>
        </section>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 bg-saffron hover:bg-saffron-600 disabled:opacity-60 text-white font-semibold px-5 py-3 rounded-md transition-colors"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isPending ? "Saving…" : "Save settings"}
            </button>
            {saved && !isPending && <span className="text-xs text-forest">Saved.</span>}
          </div>
        )}
      </fieldset>
      {error && (
        <p className="text-sm text-rust mt-4" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

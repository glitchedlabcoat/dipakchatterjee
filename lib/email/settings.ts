// lib/email/settings.ts
//
// The non-secret email configuration kept in public.email_settings (one
// row). Secrets never live here: see lib/email/config.ts.

import { z } from "zod";
import type { EmailSettingsRow } from "@/types/domain";
import { formatMailbox, isOnDomain, isValidEmail, normalizeEmail, sanitizeDisplayName } from "@/lib/email/address";
import { getDefaultSender, getVerifiedDomain } from "@/lib/email/config";
import {
  DEFAULT_TIMEZONE,
  REMINDER_FREQUENCIES,
  localDateString,
  validateSchedule,
  type ReminderFrequency,
  type ReminderSchedule,
} from "@/lib/email/schedule";

export const DEFAULT_BRAND_NAME = "Dipak Chatterjee";

export type EmailSettings = {
  /** False when the email_settings row (or table) doesn't exist yet. */
  persisted: boolean;
  senderName: string | null;
  senderAddress: string | null;
  replyTo: string | null;
  officeNotificationEmail: string | null;
  citizenConfirmationEnabled: boolean;
  officeNotificationEnabled: boolean;
  remindersEnabled: boolean;
  schedule: ReminderSchedule;
  scheduleUpdatedAt: string;
  schedulerLastRunAt: string | null;
};

export function defaultSchedule(now: number = Date.now()): ReminderSchedule {
  return {
    frequency: "weekly",
    time: "09:00",
    timezone: DEFAULT_TIMEZONE,
    weekday: 1,
    monthDay: 1,
    interval: 7,
    startDate: localDateString(now, DEFAULT_TIMEZONE),
  };
}

export function defaultEmailSettings(now: number = Date.now()): EmailSettings {
  return {
    persisted: false,
    senderName: null,
    senderAddress: null,
    replyTo: null,
    officeNotificationEmail: null,
    citizenConfirmationEnabled: true,
    officeNotificationEnabled: true,
    remindersEnabled: false,
    schedule: defaultSchedule(now),
    scheduleUpdatedAt: new Date(now).toISOString(),
    schedulerLastRunAt: null,
  };
}

function frequencyOf(value: string): ReminderFrequency {
  return (REMINDER_FREQUENCIES as readonly string[]).includes(value) ? (value as ReminderFrequency) : "weekly";
}

export function settingsFromRow(row: EmailSettingsRow | null, now: number = Date.now()): EmailSettings {
  if (!row) return defaultEmailSettings(now);
  return {
    persisted: true,
    senderName: row.sender_name,
    senderAddress: row.sender_address,
    replyTo: row.reply_to,
    officeNotificationEmail: row.office_notification_email,
    citizenConfirmationEnabled: row.citizen_confirmation_enabled,
    officeNotificationEnabled: row.office_notification_enabled,
    remindersEnabled: row.reminders_enabled,
    schedule: {
      frequency: frequencyOf(row.reminder_frequency),
      time: row.reminder_time,
      timezone: row.reminder_timezone,
      weekday: row.reminder_weekday,
      monthDay: row.reminder_month_day,
      interval: row.reminder_interval,
      startDate: row.reminder_start_date,
    },
    scheduleUpdatedAt: row.reminder_schedule_updated_at,
    schedulerLastRunAt: row.scheduler_last_run_at,
  };
}

/** The `From:` header to use, or null when no sender is configured at all. */
export function resolveSender(settings: Pick<EmailSettings, "senderName" | "senderAddress">): string | null {
  const fallback = getDefaultSender();
  if (!fallback) return null;
  const domain = getVerifiedDomain();
  const address =
    settings.senderAddress && domain && isValidEmail(settings.senderAddress) && isOnDomain(settings.senderAddress, domain)
      ? settings.senderAddress
      : fallback.address;
  const name = sanitizeDisplayName(settings.senderName) || fallback.name || DEFAULT_BRAND_NAME;
  return formatMailbox(name, address);
}

export function brandNameOf(settings: Pick<EmailSettings, "senderName">): string {
  return sanitizeDisplayName(settings.senderName) || getDefaultSender()?.name || DEFAULT_BRAND_NAME;
}

export function scheduleChanged(a: EmailSettings, b: { remindersEnabled: boolean; schedule: ReminderSchedule }): boolean {
  if (a.remindersEnabled !== b.remindersEnabled) return true;
  const x = a.schedule;
  const y = b.schedule;
  return (
    x.frequency !== y.frequency ||
    x.time !== y.time ||
    x.timezone !== y.timezone ||
    x.weekday !== y.weekday ||
    x.monthDay !== y.monthDay ||
    x.interval !== y.interval ||
    x.startDate !== y.startDate
  );
}

// ---------------------------------------------------------------------------
// Admin input

const optionalEmail = (label: string) =>
  z
    .string()
    .trim()
    .max(254, `${label} is too long.`)
    .transform((v) => (v === "" ? null : normalizeEmail(v)))
    .refine((v) => v === null || isValidEmail(v), `${label} is not a valid email address.`);

export const emailSettingsInputSchema = z.object({
  senderName: z
    .string()
    .trim()
    .max(80, "Sender name must be 80 characters or fewer.")
    .refine((v) => v === sanitizeDisplayName(v), "Sender name can't contain quotes, angle brackets or line breaks.")
    .transform((v) => v || null),
  senderAddress: optionalEmail("Sender address"),
  replyTo: optionalEmail("Reply-to address"),
  officeNotificationEmail: optionalEmail("Notification recipient"),
  citizenConfirmationEnabled: z.boolean(),
  officeNotificationEnabled: z.boolean(),
  remindersEnabled: z.boolean(),
  schedule: z.object({
    frequency: z.enum(REMINDER_FREQUENCIES),
    time: z.string(),
    timezone: z.string(),
    weekday: z.number().int(),
    monthDay: z.number().int(),
    interval: z.number().int(),
    startDate: z.string(),
  }),
});

export type EmailSettingsInput = z.input<typeof emailSettingsInputSchema>;
export type ParsedEmailSettingsInput = z.output<typeof emailSettingsInputSchema>;

export type SettingsValidation =
  | { ok: true; value: ParsedEmailSettingsInput }
  | { ok: false; error: string };

/** Schema checks plus the rules that depend on the environment (verified domain). */
export function validateSettingsInput(input: unknown): SettingsValidation {
  const parsed = emailSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings and try again." };
  const value = parsed.data;

  if (value.senderAddress) {
    const domain = getVerifiedDomain();
    if (!domain) return { ok: false, error: "Set RESEND_FROM_EMAIL on the server before choosing a sender address." };
    if (!isOnDomain(value.senderAddress, domain)) {
      return { ok: false, error: `The sender address must be on the verified domain (@${domain}).` };
    }
  }

  const schedule = validateSchedule(value.schedule);
  if (!schedule.ok) return { ok: false, error: schedule.error };

  if ((value.officeNotificationEnabled || value.remindersEnabled) && !value.officeNotificationEmail) {
    return { ok: false, error: "Enter the notification recipient, or turn off notifications and reminders." };
  }

  return { ok: true, value };
}

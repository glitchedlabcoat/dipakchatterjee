// lib/email/schedule.ts
//
// Pure date maths for the unresolved-complaint reminder schedule. No I/O,
// no Date.now() unless passed in, so every rule here is unit-tested.
//
// A schedule is a local wall-clock time ("09:00") in an IANA time zone
// (default Asia/Kolkata) plus a rule for which local dates it fires on:
//   daily           every date
//   weekly          one ISO weekday (1 = Monday … 7 = Sunday)
//   monthly         one day of the month; in shorter months (e.g. day 31
//                   in April, day 29-31 in February) it fires on that
//                   month's last day instead, so no month is skipped
//   every_n_days    every N days (1-365) counted from a start date
//   every_n_months  every N months (1-24) from a start date, on the start
//                   date's day of the month (clamped to the last day the
//                   same way as monthly)
// The most frequent schedule is once a day: there is no sub-daily option.
//
// Daylight saving (irrelevant for Asia/Kolkata, which has none, but
// defined for any zone an admin picks), matching Temporal's
// "compatible" rule:
//   * a time that doesn't exist (clocks jump forward past it) fires at
//     the same distance after the jump, e.g. 02:30 becomes 03:30;
//   * a time that happens twice (clocks fall back) fires on the first.

export const REMINDER_FREQUENCIES = ["daily", "weekly", "monthly", "every_n_days", "every_n_months"] as const;
export type ReminderFrequency = (typeof REMINDER_FREQUENCIES)[number];

export type ReminderSchedule = {
  frequency: ReminderFrequency;
  /** 24-hour "HH:MM". */
  time: string;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday (weekly only). */
  weekday: number;
  /** 1-31 (monthly only). */
  monthDay: number;
  /** Days (every_n_days) or months (every_n_months). */
  interval: number;
  /** "YYYY-MM-DD" in the schedule's zone (every_n_days / every_n_months). */
  startDate: string;
};

export const INTERVAL_LIMITS = {
  every_n_days: { min: 1, max: 365 },
  every_n_months: { min: 1, max: 24 },
} as const;

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const DAY_MS = 24 * 60 * 60 * 1000;
// Longest gap between two occurrences: 24 months ≈ 731 days, plus slack.
const SEARCH_DAYS = 745;

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---------------------------------------------------------------------------
// Time zones

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

// Region/City names only: no raw offsets ("+05:30"), which Intl may also
// accept but which don't follow daylight-saving rules.
const ZONE_NAME_RE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** An IANA zone name that this runtime's Intl can resolve (legacy aliases included). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length > 64 || !ZONE_NAME_RE.test(timeZone)) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

// Node's bundled ICU still lists some zones under their old names
// (Asia/Calcutta, not Asia/Kolkata). Show the current IANA names; Intl
// accepts both.
const MODERN_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
};

export function listTimeZones(): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone").map((z) => MODERN_ZONE_NAMES[z] ?? z);
  } catch {
    zones = [];
  }
  const rest = zones.filter((z) => z !== DEFAULT_TIMEZONE && z !== "UTC").sort();
  return [DEFAULT_TIMEZONE, "UTC", ...rest];
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function localParts(utcMs: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Local time minus UTC, in ms, at the given instant. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a local wall-clock time, with the DST rule above. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetMs(wall - DAY_MS, timeZone);
  const after = offsetMs(wall + DAY_MS, timeZone);
  const valid = [...new Set([wall - before, wall - after])]
    .filter((candidate) => offsetMs(candidate, timeZone) === wall - candidate)
    .sort((a, b) => a - b);
  if (valid.length > 0) return valid[0];
  // Skipped by a forward jump: keep the pre-jump offset, which lands the
  // same distance after the jump.
  return wall - before;
}

// ---------------------------------------------------------------------------
// Civil-date helpers (local calendar dates as day numbers)

function civilToDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dayNumberToCivil(dayNumber: number): { year: number; month: number; day: number } {
  const d = new Date(dayNumber * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoWeekday(year: number, month: number, day: number): number {
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export function parseDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Today's date in the zone, as "YYYY-MM-DD". */
export function localDateString(utcMs: number, timeZone: string): string {
  const p = localParts(utcMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Validation

export type ScheduleValidation = { ok: true; schedule: ReminderSchedule } | { ok: false; error: string };

export function validateSchedule(input: ReminderSchedule): ScheduleValidation {
  if (!REMINDER_FREQUENCIES.includes(input.frequency)) return { ok: false, error: "Choose how often reminders are sent." };
  if (!parseTime(input.time)) return { ok: false, error: "Enter the reminder time as HH:MM (24-hour)." };
  if (!isValidTimeZone(input.timezone)) return { ok: false, error: "Choose a valid time zone." };

  if (input.frequency === "weekly" && !(Number.isInteger(input.weekday) && input.weekday >= 1 && input.weekday <= 7)) {
    return { ok: false, error: "Choose a day of the week." };
  }
  if (input.frequency === "monthly" && !(Number.isInteger(input.monthDay) && input.monthDay >= 1 && input.monthDay <= 31)) {
    return { ok: false, error: "Choose a day of the month between 1 and 31." };
  }
  if (input.frequency === "every_n_days" || input.frequency === "every_n_months") {
    const { min, max } = INTERVAL_LIMITS[input.frequency];
    const unit = input.frequency === "every_n_days" ? "days" : "months";
    if (!(Number.isInteger(input.interval) && input.interval >= min && input.interval <= max)) {
      return { ok: false, error: `The interval must be a whole number of ${unit} between ${min} and ${max}.` };
    }
    if (!parseDate(input.startDate)) return { ok: false, error: "Enter a valid start date." };
  }

  return { ok: true, schedule: input };
}

// ---------------------------------------------------------------------------
// Occurrences

function firesOn(s: ReminderSchedule, year: number, month: number, day: number): boolean {
  switch (s.frequency) {
    case "daily":
      return true;
    case "weekly":
      return isoWeekday(year, month, day) === s.weekday;
    case "monthly":
      return day === Math.min(s.monthDay, daysInMonth(year, month));
    case "every_n_days": {
      const start = parseDate(s.startDate);
      if (!start) return false;
      const diff = civilToDayNumber(year, month, day) - civilToDayNumber(start.year, start.month, start.day);
      return diff >= 0 && diff % s.interval === 0;
    }
    case "every_n_months": {
      const start = parseDate(s.startDate);
      if (!start) return false;
      const months = (year - start.year) * 12 + (month - start.month);
      return months >= 0 && months % s.interval === 0 && day === Math.min(start.day, daysInMonth(year, month));
    }
  }
}

function occurrenceAt(s: ReminderSchedule, dayNumber: number): number | null {
  const { year, month, day } = dayNumberToCivil(dayNumber);
  if (!firesOn(s, year, month, day)) return null;
  const t = parseTime(s.time);
  if (!t) return null;
  return zonedTimeToUtc(year, month, day, t.hour, t.minute, s.timezone);
}

/** The latest occurrence at or before `nowMs`, or null if none in range. */
export function previousOccurrence(s: ReminderSchedule, nowMs: number): number | null {
  if (!validateSchedule(s).ok) return null;
  const today = localParts(nowMs, s.timezone);
  let dayNumber = civilToDayNumber(today.year, today.month, today.day) + 1;
  for (let i = 0; i <= SEARCH_DAYS; i++, dayNumber--) {
    const at = occurrenceAt(s, dayNumber);
    if (at !== null && at <= nowMs) return at;
  }
  return null;
}

/** The first occurrence strictly after `afterMs`, or null if none in range. */
export function nextOccurrence(s: ReminderSchedule, afterMs: number): number | null {
  if (!validateSchedule(s).ok) return null;
  const today = localParts(afterMs, s.timezone);
  let dayNumber = civilToDayNumber(today.year, today.month, today.day) - 1;
  for (let i = 0; i <= SEARCH_DAYS; i++, dayNumber++) {
    const at = occurrenceAt(s, dayNumber);
    if (at !== null && at > afterMs) return at;
  }
  return null;
}

/** nextOccurrence() from the current time (for UI previews, after hydration). */
export function nextOccurrenceFromNow(s: ReminderSchedule): number | null {
  return nextOccurrence(s, Date.now());
}

/**
 * The occurrence a scheduler run at `nowMs` should send, if any: the most
 * recent one, provided it isn't older than the last schedule change
 * (`notBeforeMs`). Only ever one occurrence, so a scheduler that was down
 * for a while sends one late reminder rather than a backlog. The caller
 * de-duplicates on the returned instant.
 */
export function dueOccurrence(s: ReminderSchedule, nowMs: number, notBeforeMs: number): number | null {
  const prev = previousOccurrence(s, nowMs);
  if (prev === null || prev < notBeforeMs) return null;
  return prev;
}

// ---------------------------------------------------------------------------
// Labels

export function describeSchedule(s: ReminderSchedule): string {
  const at = `at ${s.time} (${s.timezone})`;
  switch (s.frequency) {
    case "daily":
      return `Every day ${at}`;
    case "weekly":
      return `Every ${WEEKDAY_NAMES[s.weekday - 1] ?? "week"} ${at}`;
    case "monthly":
      return s.monthDay > 28
        ? `On day ${s.monthDay} of every month ${at}, or the month's last day if it is shorter`
        : `On day ${s.monthDay} of every month ${at}`;
    case "every_n_days":
      return s.interval === 1
        ? `Every day ${at}, starting ${s.startDate}`
        : `Every ${s.interval} days ${at}, starting ${s.startDate}`;
    case "every_n_months":
      return s.interval === 1
        ? `Every month ${at}, on the day of ${s.startDate}`
        : `Every ${s.interval} months ${at}, starting ${s.startDate}`;
  }
}

export function formatInZone(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(utcMs));
}

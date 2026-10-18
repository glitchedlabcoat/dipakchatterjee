import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSchedule,
  dueOccurrence,
  nextOccurrence,
  previousOccurrence,
  validateSchedule,
  zonedTimeToUtc,
  type ReminderSchedule,
} from "@/lib/email/schedule";

const base: ReminderSchedule = {
  frequency: "daily",
  time: "09:00",
  timezone: "Asia/Kolkata",
  weekday: 1,
  monthDay: 1,
  interval: 7,
  startDate: "2026-10-17",
};
const s = (patch: Partial<ReminderSchedule>): ReminderSchedule => ({ ...base, ...patch });
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const at = (value: string) => Date.parse(value);

test("validateSchedule accepts every supported schedule type", () => {
  for (const schedule of [
    s({ frequency: "daily" }),
    s({ frequency: "weekly", weekday: 7 }),
    s({ frequency: "monthly", monthDay: 31 }),
    s({ frequency: "every_n_days", interval: 365 }),
    s({ frequency: "every_n_months", interval: 24 }),
    s({ timezone: "UTC" }),
    s({ timezone: "Asia/Calcutta" }),
    s({ timezone: "America/New_York", time: "23:59" }),
  ]) {
    assert.equal(validateSchedule(schedule).ok, true, JSON.stringify(schedule));
  }
});

test("validateSchedule rejects invalid or too-frequent schedules", () => {
  const bad: Partial<ReminderSchedule>[] = [
    { time: "24:00" },
    { time: "9:00" },
    { time: "09:00:00" },
    { timezone: "Mars/Olympus_Mons" },
    { timezone: "+05:30" },
    { timezone: "" },
    { frequency: "weekly", weekday: 0 },
    { frequency: "weekly", weekday: 8 },
    { frequency: "monthly", monthDay: 0 },
    { frequency: "monthly", monthDay: 32 },
    { frequency: "every_n_days", interval: 0 },
    { frequency: "every_n_days", interval: 366 },
    { frequency: "every_n_days", interval: 1.5 },
    { frequency: "every_n_months", interval: 25 },
    { frequency: "every_n_days", startDate: "2026-02-30" },
    { frequency: "every_n_months", startDate: "17-10-2026" },
    { frequency: "hourly" as ReminderSchedule["frequency"] },
  ];
  for (const patch of bad) {
    assert.equal(validateSchedule(s(patch)).ok, false, JSON.stringify(patch));
  }
});

test("daily: 09:00 IST is 03:30 UTC, today if not yet passed", () => {
  const schedule = s({ frequency: "daily" });
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-17T03:00:00Z"))), "2026-10-17T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-17T03:30:00Z"))), "2026-10-18T03:30:00.000Z");
  assert.equal(iso(previousOccurrence(schedule, at("2026-10-17T03:00:00Z"))), "2026-10-16T03:30:00.000Z");
  assert.equal(iso(previousOccurrence(schedule, at("2026-10-17T03:30:00Z"))), "2026-10-17T03:30:00.000Z");
});

test("weekly: the chosen weekday at the chosen time", () => {
  // 2026-10-17 is a Saturday.
  const monday = s({ frequency: "weekly", weekday: 1 });
  assert.equal(iso(nextOccurrence(monday, at("2026-10-17T06:00:00Z"))), "2026-10-19T03:30:00.000Z");
  assert.equal(iso(previousOccurrence(monday, at("2026-10-17T06:00:00Z"))), "2026-10-12T03:30:00.000Z");
  const saturday = s({ frequency: "weekly", weekday: 6, time: "18:00" });
  assert.equal(iso(nextOccurrence(saturday, at("2026-10-17T06:00:00Z"))), "2026-10-17T12:30:00.000Z");
});

test("monthly: day 31 falls on the last day of shorter months (incl. leap February)", () => {
  const schedule = s({ frequency: "monthly", monthDay: 31 });
  assert.equal(iso(nextOccurrence(schedule, at("2026-11-02T00:00:00Z"))), "2026-11-30T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2027-02-01T00:00:00Z"))), "2027-02-28T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2028-02-01T00:00:00Z"))), "2028-02-29T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2026-12-01T00:00:00Z"))), "2026-12-31T03:30:00.000Z");
  assert.equal(iso(previousOccurrence(schedule, at("2026-11-02T00:00:00Z"))), "2026-10-31T03:30:00.000Z");
});

test("monthly: an ordinary day of the month", () => {
  const schedule = s({ frequency: "monthly", monthDay: 15, time: "10:15" });
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-17T00:00:00Z"))), "2026-11-15T04:45:00.000Z");
});

test("every N days counts from the start date", () => {
  const schedule = s({ frequency: "every_n_days", interval: 3, startDate: "2026-10-17" });
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-16T00:00:00Z"))), "2026-10-17T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-17T04:00:00Z"))), "2026-10-20T03:30:00.000Z");
  assert.equal(iso(previousOccurrence(schedule, at("2026-10-22T00:00:00Z"))), "2026-10-20T03:30:00.000Z");
  // Nothing before the start date.
  assert.equal(previousOccurrence(schedule, at("2026-10-16T00:00:00Z")), null);
});

test("every N months keeps the start day, clamped in short months", () => {
  const schedule = s({ frequency: "every_n_months", interval: 1, startDate: "2026-01-31" });
  assert.equal(iso(nextOccurrence(schedule, at("2026-02-01T00:00:00Z"))), "2026-02-28T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(schedule, at("2026-03-01T00:00:00Z"))), "2026-03-31T03:30:00.000Z");
  const every2 = s({ frequency: "every_n_months", interval: 2, startDate: "2026-01-31" });
  assert.equal(iso(nextOccurrence(every2, at("2026-02-01T00:00:00Z"))), "2026-03-31T03:30:00.000Z");
  assert.equal(iso(nextOccurrence(every2, at("2026-04-01T00:00:00Z"))), "2026-05-31T03:30:00.000Z");
  const every24 = s({ frequency: "every_n_months", interval: 24, startDate: "2026-10-17" });
  assert.equal(iso(nextOccurrence(every24, at("2026-10-18T00:00:00Z"))), "2028-10-17T03:30:00.000Z");
});

test("time zone: local month and day boundaries differ from UTC", () => {
  // 00:15 IST on the 1st is still the previous day (and month) in UTC.
  const schedule = s({ frequency: "monthly", monthDay: 1, time: "00:15" });
  assert.equal(iso(nextOccurrence(schedule, at("2026-10-17T00:00:00Z"))), "2026-10-31T18:45:00.000Z");
  // 23:30 IST on the 31st is the 31st in UTC too, at 18:00.
  const late = s({ frequency: "monthly", monthDay: 31, time: "23:30" });
  assert.equal(iso(nextOccurrence(late, at("2026-10-17T00:00:00Z"))), "2026-10-31T18:00:00.000Z");
});

test("daylight saving: a skipped time shifts forward, a repeated time uses the first", () => {
  // New York springs forward at 02:00 on 2026-03-08; 02:30 doesn't exist.
  assert.equal(iso(zonedTimeToUtc(2026, 3, 8, 2, 30, "America/New_York")), "2026-03-08T07:30:00.000Z");
  // It falls back at 02:00 on 2026-11-01; 01:30 happens twice (EDT first).
  assert.equal(iso(zonedTimeToUtc(2026, 11, 1, 1, 30, "America/New_York")), "2026-11-01T05:30:00.000Z");
  // A daily 09:00 reminder stays at 09:00 local on both sides of the change.
  const ny = s({ timezone: "America/New_York" });
  assert.equal(iso(nextOccurrence(ny, at("2026-03-07T15:00:00Z"))), "2026-03-08T13:00:00.000Z");
  assert.equal(iso(nextOccurrence(ny, at("2026-03-06T15:00:00Z"))), "2026-03-07T14:00:00.000Z");
});

test("dueOccurrence ignores occurrences from before the last schedule change", () => {
  const schedule = s({ frequency: "daily" });
  const now = at("2026-10-17T05:00:00Z"); // 10:30 IST, after today's 09:00
  // Changed at 10:00 IST today: today's 09:00 must not fire.
  assert.equal(dueOccurrence(schedule, now, at("2026-10-17T04:30:00Z")), null);
  // Changed yesterday: today's 09:00 is due.
  assert.equal(iso(dueOccurrence(schedule, now, at("2026-10-16T12:00:00Z"))), "2026-10-17T03:30:00.000Z");
  // A scheduler that was down for days still sends only the latest one.
  assert.equal(iso(dueOccurrence(schedule, at("2026-10-20T05:00:00Z"), at("2026-10-10T00:00:00Z"))), "2026-10-20T03:30:00.000Z");
});

test("describeSchedule produces readable labels", () => {
  assert.equal(describeSchedule(s({ frequency: "weekly", weekday: 1 })), "Every Monday at 09:00 (Asia/Kolkata)");
  assert.match(describeSchedule(s({ frequency: "monthly", monthDay: 30 })), /last day/);
  assert.equal(describeSchedule(s({ frequency: "every_n_days", interval: 3 })), "Every 3 days at 09:00 (Asia/Kolkata), starting 2026-10-17");
});

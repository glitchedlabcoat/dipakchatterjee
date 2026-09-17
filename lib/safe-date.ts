// lib/safe-date.ts
//
// `new Date(garbage)` never throws by itself — it silently produces an
// Invalid Date, whose numeric getters (`getTime()`, `getFullYear()`, ...)
// just return `NaN`. The throw only happens one step later, at
// `.toISOString()`/`.toUTCString()`/`Intl.DateTimeFormat().format()`,
// as `RangeError: Invalid time value`. These two helpers are the one
// place that validity check lives, for any date value that traces back
// to something other than `new Date()` with no arguments or a column
// enforced NOT NULL at the database level (an admin form field, a
// hand-authored data file, anything crossing a request/response
// boundary) — see app/admin/(protected)/posts/actions.ts and
// components/admin/ChangelogBrowser.tsx for the two real call sites.

export function safeDate(value: unknown, fallback: Date = new Date()): Date {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function safeToISOString(value: unknown, fallback: string = new Date().toISOString()): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

// For call sites that should OMIT a field rather than substitute a
// fallback when the input is empty/unparseable (e.g. so a DB column's
// own `default now()` applies) — returns null instead of falling back.
export function parseValidDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

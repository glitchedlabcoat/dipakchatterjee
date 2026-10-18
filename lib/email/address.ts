// lib/email/address.ts
//
// Email-address helpers shared by the complaint form, the admin composer,
// the settings form and the inbound webhook. Deliberately stricter than
// RFC 5321: the local part may only use letters, digits and . _ % + ' -
// (no quoted strings, braces, commas or angle brackets), so a validated
// address can be dropped into a header, a PostgREST filter or an array
// literal without any further escaping.

export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

const LOCAL_RE = /^[A-Za-z0-9._%+'-]+$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD_RE = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

export function isValidEmail(value: string): boolean {
  if (typeof value !== "string" || value.length < 6 || value.length > MAX_EMAIL_LENGTH) return false;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at !== value.indexOf("@")) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_RE.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL_RE.test(label))) return false;
  return TLD_RE.test(labels[labels.length - 1]);
}

/** Trims and lower-cases the domain; the local part keeps its case. */
export function normalizeEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** True for the domain itself or any of its subdomains. */
export function isOnDomain(email: string, domain: string): boolean {
  const d = domainOf(email);
  const target = domain.toLowerCase();
  return d === target || d.endsWith(`.${target}`);
}

/** "ab•••@gmail.com" — enough to recognise an address in a log, not to harvest it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}•••@${email.slice(at + 1)}`;
}

export type AddressListResult = { ok: true; addresses: string[] } | { ok: false; error: string };

/** Splits on commas, semicolons and whitespace; de-duplicates case-insensitively. */
export function parseAddressList(input: string, max: number): AddressListResult {
  const parts = input
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return { ok: false, error: "Enter at least one recipient." };

  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of parts) {
    const address = normalizeEmail(part);
    if (!isValidEmail(address)) return { ok: false, error: `"${part.slice(0, 80)}" is not a valid email address.` };
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }

  if (addresses.length > max) return { ok: false, error: `Use at most ${max} recipients per message.` };
  return { ok: true, addresses };
}

/** Removes anything that could break out of a quoted display name or a header line. */
export function sanitizeDisplayName(name: string | null | undefined, maxLength = 80): string {
  if (!name) return "";
  return name
    .replace(/[\u0000-\u001f\u007f"<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** `"Name" <address>`, or the bare address when there's no usable name. */
export function formatMailbox(name: string | null | undefined, address: string): string {
  const clean = sanitizeDisplayName(name);
  return clean ? `"${clean}" <${address}>` : address;
}

/** Parses `Name <address>`, `"Name" <address>` or a bare address. */
export function parseMailbox(value: string | null | undefined): { name: string | null; address: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(.*)<([^<>\s]+)>$/.exec(trimmed);
  if (match) {
    const address = normalizeEmail(match[2]);
    if (!isValidEmail(address)) return null;
    const name = sanitizeDisplayName(match[1].replace(/^"|"$/g, ""));
    return { name: name || null, address };
  }
  const address = normalizeEmail(trimmed);
  return isValidEmail(address) ? { name: null, address } : null;
}

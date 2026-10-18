// Addresses, templates and settings validation.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RESEND_FROM_EMAIL = "Dipak Chatterjee <office@janatardipak.com>";

const { formatMailbox, isValidEmail, maskEmail, parseAddressList, parseMailbox } = await import("@/lib/email/address");
const { cleanSubject, renderComplaintReceipt, renderOfficeNotification, renderReminder, renderPlainMessage } = await import(
  "@/lib/email/templates"
);
const { defaultSchedule, resolveSender, validateSettingsInput } = await import("@/lib/email/settings");

test("isValidEmail accepts ordinary addresses and rejects risky or malformed ones", () => {
  for (const ok of ["a.b@example.com", "o'brien+tag@mail.example.co.in", "x_y-z@sub.domain.org", "A@B.CO"]) {
    assert.equal(isValidEmail(ok), true, ok);
  }
  for (const bad of [
    "",
    "plain",
    "a@b",
    "a@@b.com",
    "a b@example.com",
    "a@example.com\r\nBcc: x@evil.com",
    "<a@example.com>",
    '"quoted"@example.com',
    "a,b@example.com",
    "a@-example.com",
    ".a@example.com",
    "a..b@example.com",
    `${"x".repeat(65)}@example.com`,
    `a@${"x".repeat(250)}.com`,
    "a@example.c",
  ]) {
    assert.equal(isValidEmail(bad), false, JSON.stringify(bad));
  }
});

test("parseAddressList de-duplicates, enforces the limit and names the bad entry", () => {
  assert.deepEqual(parseAddressList("a@x.org, A@X.org; b@x.org\nc@x.org", 10), { ok: true, addresses: ["a@x.org", "b@x.org", "c@x.org"] });
  const tooMany = parseAddressList(Array.from({ length: 11 }, (_, i) => `u${i}@x.org`).join(","), 10);
  assert.equal(tooMany.ok, false);
  const bad = parseAddressList("good@x.org, not-an-email", 10);
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /not-an-email/);
  assert.equal(parseAddressList("   ", 10).ok, false);
});

test("maskEmail, formatMailbox and parseMailbox", () => {
  assert.equal(maskEmail("citizen@gmail.com"), "ci•••@gmail.com");
  assert.equal(formatMailbox('Evil" <x@y.z>\r\nBcc: a@b.c', "office@janatardipak.com"), '"Evil x@y.zBcc: a@b.c" <office@janatardipak.com>');
  assert.deepEqual(parseMailbox('"Office" <office@janatardipak.com>'), { name: "Office", address: "office@janatardipak.com" });
  assert.equal(parseMailbox("not an address"), null);
});

const submittedAt = new Date("2026-10-17T09:34:00Z");

test("receipt: reference, IST time, retention advice and no-outcome disclaimer; escapes input", () => {
  const r = renderComplaintReceipt({
    brandName: "Dipak <script>",
    reference: "REF-1A2B3C4D",
    submittedAt,
    timeZone: "Asia/Kolkata",
    office: { email: "office@example.org", address: "Chanchal <b>Malda</b>" },
    siteUrl: "https://janatardipak.com",
  });
  assert.equal(r.subject, "We received your complaint (REF-1A2B3C4D)");
  for (const body of [r.html, r.text]) {
    assert.match(body, /REF-1A2B3C4D/);
    assert.match(body, /17 Oct 2026, 3:04 pm IST/);
    assert.match(body, /keep this reference number/);
    assert.match(body, /does not guarantee any particular outcome or response time/);
  }
  assert.doesNotMatch(r.html, /<script>|<b>Malda/);
  assert.match(r.html, /Dipak &lt;script&gt;/);
  assert.doesNotMatch(r.html + r.text, /reviewed and|has been resolved/);
});

test("office notification: reference, time and dashboard link, no complaint details", () => {
  const r = renderOfficeNotification({
    brandName: "Dipak Chatterjee",
    reference: "REF-1A2B3C4D",
    submittedAt,
    timeZone: "Asia/Kolkata",
    adminUrl: "https://janatardipak.com/admin/complaints?complaint=1a2b3c4d-0000-4000-8000-000000000000",
    attachmentCount: 2,
    phoneProvided: true,
    emailProvided: false,
  });
  assert.equal(r.subject, "New complaint REF-1A2B3C4D");
  assert.match(r.html, /href="https:\/\/janatardipak\.com\/admin\/complaints\?complaint=1a2b3c4d-0000-4000-8000-000000000000"/);
  assert.match(r.text, /sign-in required/);
  assert.match(r.text, /left a phone number\. 2 attachments\./);
});

test("reminder: lists each complaint with age and link; handles none", () => {
  const now = new Date("2026-10-20T05:00:00Z");
  const r = renderReminder({
    brandName: "Dipak Chatterjee",
    items: [{ reference: "REF-AAAA0001", submittedAt, adminUrl: "https://janatardipak.com/admin/complaints?complaint=x" }],
    total: 3,
    now,
    timeZone: "Asia/Kolkata",
    complaintsUrl: "https://janatardipak.com/admin/complaints",
    scheduleLabel: "Every day at 09:00 (Asia/Kolkata)",
  });
  assert.equal(r.subject, "Reminder: 3 unresolved complaints");
  assert.match(r.text, /REF-AAAA0001 \| submitted 17 Oct 2026, 3:04 pm IST \| 2 days old/);
  assert.match(r.text, /and 2 more/);

  const empty = renderReminder({ ...{ brandName: "D", items: [], total: 0, now, timeZone: "Asia/Kolkata", complaintsUrl: "u", scheduleLabel: "l" } });
  assert.equal(empty.subject, "Reminder: no unresolved complaints");
  assert.match(empty.text, /no unresolved complaints/);
});

test("subjects can't carry header line breaks; composed text is escaped", () => {
  assert.equal(cleanSubject("Hello\r\nBcc: victim@example.com"), "Hello Bcc: victim@example.com");
  const msg = renderPlainMessage({ brandName: "D", subject: "Hi", body: "<img src=x onerror=alert(1)>\n\nSecond" });
  assert.doesNotMatch(msg.html, /<img/);
  assert.match(msg.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

const validInput = {
  senderName: "Dipak Chatterjee",
  senderAddress: "office@janatardipak.com",
  replyTo: "",
  officeNotificationEmail: "dipak@example.org",
  citizenConfirmationEnabled: true,
  officeNotificationEnabled: true,
  remindersEnabled: true,
  schedule: defaultSchedule(Date.parse("2026-10-17T00:00:00Z")),
};

test("settings: valid input passes and normalizes blanks to null", () => {
  const result = validateSettingsInput(validInput);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.replyTo, null);
});

test("settings: rejects off-domain senders, bad emails, unsafe names, bad schedules, missing recipient", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ senderAddress: "me@gmail.com" }, /verified domain/],
    [{ replyTo: "nope" }, /Reply-to address is not a valid/],
    [{ officeNotificationEmail: "x@y" }, /Notification recipient is not a valid/],
    [{ senderName: 'Office" <evil@x.com>' }, /quotes, angle brackets/],
    [{ schedule: { ...validInput.schedule, time: "25:00" } }, /HH:MM/],
    [{ schedule: { ...validInput.schedule, frequency: "every_n_days", interval: 0 } }, /between 1 and 365/],
    [{ officeNotificationEmail: "" }, /notification recipient/],
  ];
  for (const [patch, pattern] of cases) {
    const result = validateSettingsInput({ ...validInput, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.ok ? "" : result.error, pattern);
  }
  // Recipient may be blank when nothing needs it.
  assert.equal(
    validateSettingsInput({ ...validInput, officeNotificationEmail: "", officeNotificationEnabled: false, remindersEnabled: false }).ok,
    true
  );
});

test("resolveSender only uses addresses on the verified domain", () => {
  assert.equal(resolveSender({ senderName: "Office", senderAddress: "help@janatardipak.com" }), '"Office" <help@janatardipak.com>');
  assert.equal(resolveSender({ senderName: null, senderAddress: "spoof@gmail.com" }), '"Dipak Chatterjee" <office@janatardipak.com>');
});

// Feature A (citizen receipt), Feature B (office notification), the
// outbox's retry/idempotency rules, Feature C (reminders) and the
// scheduler tick, all against the in-memory store and a fake Resend.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RESEND_FROM_EMAIL = "Dipak Chatterjee <office@janatardipak.com>";

const { MemoryStore } = await import("@/tests/unit/helpers/memory-store");
const { FakeSender, permanentError, transientError } = await import("@/tests/unit/helpers/fake-sender");
const { queueComplaintEmails, RECEIPTS_PER_ADDRESS_PER_DAY } = await import("@/lib/email/complaint-emails");
const { deliverMessage, deliverMessages, processDueMessages, requeueMessage, MAX_ATTEMPTS, STALE_CLAIM_MS } = await import(
  "@/lib/email/outbox"
);
const { queueDueReminder } = await import("@/lib/email/reminders");
const { runEmailDispatch } = await import("@/lib/email/dispatch");
const { formatReferenceNumber } = await import("@/lib/reference");

const SITE = "https://janatardipak.com";

function setup(settings: Record<string, unknown> = {}, start = "2026-10-17T06:00:00Z") {
  let now = new Date(start);
  const clock = () => now;
  const store = new MemoryStore({
    now: clock,
    settings: { officeNotificationEmail: "dipak@example.org", ...settings },
  });
  const sender = new FakeSender();
  const deps = { store, send: sender.send, now: clock, siteUrl: SITE, fetchReceived: null };
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { store, sender, deps, advance, clock };
}

// --- Feature A + B: queueing ----------------------------------------------

test("complaint without an email: office notification only, no citizen receipt", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint();
  const queued = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  assert.equal(queued.receiptQueued, false);
  assert.deepEqual(store.messageList().map((m) => m.kind), ["office_notification"]);
  await deliverMessages(deps, queued.ids);
  assert.equal(sender.delivered.length, 1);
  assert.deepEqual(sender.delivered[0].email.to, ["dipak@example.org"]);
});

test("complaint with an email: receipt to the citizen plus the office notification", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint({ contact_email: "Citizen@Example.com", contact_phone: "9876543210", media: 2 });
  const queued = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "Citizen@Example.com" }, store.clock());
  assert.equal(queued.receiptQueued, true);
  assert.equal(queued.ids.length, 2);
  await deliverMessages(deps, queued.ids);

  const receipt = sender.delivered.find((d) => d.email.to[0] === "citizen@example.com");
  const notice = sender.delivered.find((d) => d.email.to[0] === "dipak@example.org");
  assert.ok(receipt && notice);
  const ref = formatReferenceNumber(c.id);
  assert.match(receipt.email.subject, new RegExp(ref));
  assert.match(receipt.email.text, /does not guarantee/);
  assert.equal(receipt.email.from, '"Dipak Chatterjee" <office@janatardipak.com>');
  assert.equal(notice.email.subject, `New complaint ${ref}`);
  assert.ok(notice.email.html.includes(`${SITE}/admin/complaints?complaint=${c.id}`));
  assert.doesNotMatch(notice.email.html + notice.email.text, /9876543210|citizen@example\.com/i);
});

test("each email can be turned off independently", async () => {
  const { store } = setup({ officeNotificationEnabled: false, citizenConfirmationEnabled: true });
  const c = store.addComplaint();
  await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  assert.deepEqual(store.messageList().map((m) => m.kind), ["complaint_receipt"]);

  const off = setup({ officeNotificationEnabled: true, citizenConfirmationEnabled: false });
  const c2 = off.store.addComplaint();
  const queued = await queueComplaintEmails(off.store, { complaintId: c2.id, contactEmail: "a@example.com" }, off.store.clock());
  assert.equal(queued.receiptQueued, false);
  assert.deepEqual(off.store.messageList().map((m) => m.kind), ["office_notification"]);
});

test("missing notification recipient is recorded as skipped, never sent", async () => {
  const { store, sender, deps } = setup({ officeNotificationEmail: null });
  const c = store.addComplaint();
  const queued = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  assert.deepEqual(queued.ids, []);
  const [row] = store.messageList();
  assert.equal(row.status, "skipped");
  assert.match(row.last_error ?? "", /No notification recipient/);
  await processDueMessages(deps);
  assert.equal(sender.calls.length, 0);
});

test("a duplicate invocation for the same complaint queues and sends nothing new", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint({ contact_email: "a@example.com" });
  const first = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  const second = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  assert.equal(second.ids.length, 0);
  assert.equal(second.receiptQueued, false);
  assert.equal(store.messageList().length, 2);
  await Promise.all([deliverMessages(deps, first.ids), deliverMessages(deps, first.ids), processDueMessages(deps)]);
  assert.equal(sender.delivered.length, 2);
});

test("receipts are capped per address (anti-abuse) and the cap is logged", async () => {
  const { store } = setup();
  for (let i = 0; i < RECEIPTS_PER_ADDRESS_PER_DAY + 1; i++) {
    const c = store.addComplaint();
    await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "target@example.com" }, store.clock());
  }
  const receipts = store.messageList().filter((m) => m.kind === "complaint_receipt");
  assert.equal(receipts.filter((m) => m.status === "pending").length, RECEIPTS_PER_ADDRESS_PER_DAY);
  assert.match(receipts.find((m) => m.status === "skipped")?.last_error ?? "", /already went to this address/);
});

test("the receipt cap follows the injected clock, whatever today's date is", async () => {
  // Regression: this used to pass only within 24 h of the fixed test date,
  // because the cap window was measured from the real clock.
  for (const start of ["2020-02-29T23:30:00Z", "2035-12-31T23:59:00Z"]) {
    const { store, advance } = setup({}, start);
    for (let i = 0; i < RECEIPTS_PER_ADDRESS_PER_DAY + 1; i++) {
      const c = store.addComplaint();
      await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "target@example.com" }, store.clock());
      advance(60_000);
    }
    const receipts = store.messageList().filter((m) => m.kind === "complaint_receipt");
    assert.equal(receipts.filter((m) => m.status === "skipped").length, 1, start);

    // A day later the window has moved on.
    advance(24 * 3_600_000);
    const later = store.addComplaint();
    const q = await queueComplaintEmails(store, { complaintId: later.id, contactEmail: "target@example.com" }, store.clock());
    assert.equal(q.receiptQueued, true, `${start}: cap resets after 24 h`);
  }
});

test("queueing never throws, even when the database fails", async () => {
  const { store } = setup();
  const c = store.addComplaint();
  store.failures.set("loadSettings", new Error("relation email_settings does not exist"));
  assert.deepEqual(await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock()), {
    ids: [],
    receiptQueued: false,
  });
  store.failures.set("insertMessage", new Error("connection reset"));
  const queued = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  assert.equal(queued.receiptQueued, true); // the second insert still went through
});

// --- Outbox: delivery, retries, idempotency ---------------------------------

test("a provider failure keeps the message queued and the retry is idempotent", async () => {
  const { store, sender, deps, advance } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  sender.respond(transientError);

  const first = await deliverMessage(deps, ids[0]);
  assert.equal(first.status, "retry_scheduled");
  const pending = store.messages.get(ids[0])!;
  assert.equal(pending.status, "pending");
  assert.match(pending.last_error ?? "", /application_error/);
  assert.ok(pending.body_html, "content is frozen on the first attempt");

  assert.equal((await deliverMessage(deps, ids[0])).status, "not_due");
  advance(61_000);
  const second = await deliverMessage(deps, ids[0]);
  assert.equal(second.status, "sent");
  assert.equal(sender.calls.length, 2);
  assert.equal(sender.calls[0].key, sender.calls[1].key);
  assert.equal(JSON.stringify(sender.calls[0].email), JSON.stringify(sender.calls[1].email));
  assert.equal(store.messages.get(ids[0])!.provider_message_id, "re_1");
});

test("even if a send 'times out' after Resend accepted it, the citizen gets one email", async () => {
  const { store, sender, deps, advance } = setup();
  const c = store.addComplaint({ contact_email: "a@example.com" });
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  const receiptId = ids.find((id) => store.messages.get(id)!.kind === "complaint_receipt")!;
  // First call is accepted by "Resend", but our side sees a timeout.
  const realSend = sender.send;
  let once = true;
  deps.send = async (email, key) => {
    const result = await realSend(email, key);
    if (once) {
      once = false;
      return { ok: false, retryable: true, outcomeUnknown: true, status: null, code: "timeout", message: "timed out" };
    }
    return result;
  };
  assert.equal((await deliverMessage(deps, receiptId)).status, "retry_scheduled");
  advance(61_000);
  assert.equal((await deliverMessage(deps, receiptId)).status, "sent");
  assert.equal(sender.delivered.filter((d) => d.email.to[0] === "a@example.com").length, 1);
});

test("permanent errors fail immediately; transient ones stop after MAX_ATTEMPTS", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  sender.respond(permanentError);
  assert.equal((await deliverMessage(deps, ids[0])).status, "failed");
  assert.equal(store.messages.get(ids[0])!.status, "failed");

  const t = setup();
  const c2 = t.store.addComplaint();
  const q2 = await queueComplaintEmails(t.store, { complaintId: c2.id, contactEmail: null }, t.store.clock());
  t.sender.respond(...Array(MAX_ATTEMPTS).fill(transientError));
  const statuses: string[] = [];
  for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
    statuses.push((await deliverMessage(t.deps, q2.ids[0], { force: true })).status);
    t.advance(60_000);
  }
  assert.deepEqual(statuses, [...Array(MAX_ATTEMPTS - 1).fill("retry_scheduled"), "failed", "not_due"]);
  assert.equal(t.sender.calls.length, MAX_ATTEMPTS);
});

test("automatic retries stop at the 23-hour idempotency window", async () => {
  const { store, sender, deps, advance } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  sender.respond(...Array(MAX_ATTEMPTS).fill(transientError));
  const statuses: string[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await deliverMessage(deps, ids[0], { force: true })).status);
    advance(7 * 3_600_000);
  }
  // Attempt 5 lands 28 h after the first, so its retry would fall outside
  // Resend's 24 h key retention: it fails instead (admin can retry).
  assert.deepEqual(statuses, ["retry_scheduled", "retry_scheduled", "retry_scheduled", "retry_scheduled", "failed"]);
});

test("without RESEND_API_KEY a message is skipped with a clear reason", async () => {
  const { store, deps } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  const outcome = await deliverMessage({ ...deps, send: null }, ids[0]);
  assert.equal(outcome.status, "skipped");
  assert.match(store.messages.get(ids[0])!.last_error ?? "", /RESEND_API_KEY/);
});

test("two workers racing for one message send it once; a stuck claim is recovered later", async () => {
  const { store, sender, deps, advance } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  const results = await Promise.all([deliverMessage(deps, ids[0]), deliverMessage(deps, ids[0]), deliverMessage(deps, ids[0])]);
  assert.equal(results.filter((r) => r.status === "sent").length, 1);
  assert.equal(sender.calls.length, 1);

  // A worker that died mid-send leaves the row in "sending".
  const c2 = store.addComplaint();
  const q2 = await queueComplaintEmails(store, { complaintId: c2.id, contactEmail: null }, store.clock());
  const row = store.messages.get(q2.ids[0])!;
  store.messages.set(row.id, { ...row, status: "sending", claimed_at: deps.now().toISOString(), attempts: 1 });
  assert.equal((await deliverMessage(deps, row.id)).status, "busy");
  advance(STALE_CLAIM_MS + 1000);
  assert.equal((await deliverMessage(deps, row.id)).status, "sent");
});

test("a complaint deleted before sending skips its emails", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint({ contact_email: "a@example.com" });
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: "a@example.com" }, store.clock());
  store.complaints.delete(c.id);
  await deliverMessages(deps, ids);
  assert.equal(sender.calls.length, 0);
  assert.ok(store.messageList().every((m) => m.status === "skipped"));
});

test("an admin retry re-queues a failed message and sends it", async () => {
  const { store, sender, deps } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  sender.respond(permanentError);
  await deliverMessage(deps, ids[0]);
  assert.equal(await requeueMessage(store, store.messages.get(ids[0])!, deps.now()), true);
  assert.equal((await deliverMessage(deps, ids[0])).status, "sent");
  // Only failed/skipped rows can be re-queued.
  assert.equal(await requeueMessage(store, store.messages.get(ids[0])!, deps.now()), false);
});

// --- Feature C: reminders ---------------------------------------------------

const daily0900 = {
  frequency: "daily" as const,
  time: "09:00",
  timezone: "Asia/Kolkata",
  weekday: 1,
  monthDay: 1,
  interval: 7,
  startDate: "2026-10-01",
};

function reminderSetup(extra: Record<string, unknown> = {}) {
  // 06:00Z = 11:30 IST: today's 09:00 occurrence has passed.
  return setup({
    remindersEnabled: true,
    schedule: daily0900,
    scheduleUpdatedAt: "2026-10-16T00:00:00.000Z",
    ...extra,
  });
}

test("disabled reminders (or settings never saved) send nothing", async () => {
  const off = reminderSetup({ remindersEnabled: false });
  assert.deepEqual(await queueDueReminder(off.store, off.store.settings, off.clock()), { status: "disabled" });
  const unsaved = reminderSetup({ persisted: false });
  assert.deepEqual(await queueDueReminder(unsaved.store, unsaved.store.settings, unsaved.clock()), { status: "disabled" });
  assert.equal(off.store.messageList().length + unsaved.store.messageList().length, 0);
});

test("a due reminder is queued once, however many times (or concurrently) the scheduler runs", async () => {
  const { store, sender, deps } = reminderSetup();
  store.addComplaint();
  const results = await Promise.all([1, 2, 3].map(() => runEmailDispatch(deps)));
  assert.equal(results.filter((r) => r.reminder?.status === "queued").length, 1);
  await runEmailDispatch(deps);
  const reminders = store.messageList().filter((m) => m.kind === "reminder");
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].dedupe_key, "reminder:2026-10-17T03:30:00.000Z");
  assert.equal(sender.delivered.filter((d) => d.email.subject.startsWith("Reminder")).length, 1);
});

test("the next occurrence produces a new reminder", async () => {
  const { store, sender, deps, advance } = reminderSetup();
  await runEmailDispatch(deps);
  advance(24 * 3_600_000);
  await runEmailDispatch(deps);
  assert.equal(store.messageList().filter((m) => m.kind === "reminder").length, 2);
  assert.equal(sender.delivered.length, 2);
});

test("only unresolved, unexpired complaints are listed, oldest first, with age and link", async () => {
  const { store, sender, deps, clock } = reminderSetup();
  const now = clock().getTime();
  const old = store.addComplaint({ created_at: new Date(now - 5 * 86_400_000).toISOString() });
  const recent = store.addComplaint({ created_at: new Date(now - 3_600_000).toISOString() });
  const resolved = store.addComplaint({ status: "resolved" });
  const expired = store.addComplaint({ expires_at: new Date(now - 1000).toISOString() });
  const flagged = store.addComplaint({ is_expired: true });
  await runEmailDispatch(deps);

  const [reminder] = sender.delivered;
  assert.equal(reminder.email.subject, "Reminder: 2 unresolved complaints");
  const text = reminder.email.text;
  assert.ok(text.indexOf(formatReferenceNumber(old.id)) < text.indexOf(formatReferenceNumber(recent.id)));
  assert.match(text, /5 days old/);
  assert.match(text, /less than a day old/);
  assert.ok(text.includes(`${SITE}/admin/complaints?complaint=${old.id}`));
  for (const excluded of [resolved, expired, flagged]) assert.ok(!text.includes(formatReferenceNumber(excluded.id)));
});

test("an empty list still sends a clear 'nothing unresolved' reminder", async () => {
  const { sender, deps } = reminderSetup();
  await runEmailDispatch(deps);
  assert.equal(sender.delivered[0].email.subject, "Reminder: no unresolved complaints");
});

test("turning reminders on after today's time doesn't fire a stale reminder", async () => {
  const { store, deps } = reminderSetup({ scheduleUpdatedAt: "2026-10-17T05:00:00.000Z" }); // 10:30 IST
  const report = await runEmailDispatch(deps);
  assert.deepEqual(report.reminder, { status: "not_due" });
  assert.equal(store.messageList().length, 0);
});

test("a reminder with no recipient is logged as skipped", async () => {
  const { store, sender, deps } = reminderSetup({ officeNotificationEmail: null });
  const report = await runEmailDispatch(deps);
  assert.equal(report.reminder?.status, "no_recipient");
  assert.equal(store.messageList()[0].status, "skipped");
  assert.equal(sender.calls.length, 0);
});

test("dispatch retries failed sends, records its run, and isolates step failures", async () => {
  const { store, sender, deps, advance } = setup();
  const c = store.addComplaint();
  const { ids } = await queueComplaintEmails(store, { complaintId: c.id, contactEmail: null }, store.clock());
  sender.respond(transientError);
  await deliverMessages(deps, ids);
  advance(2 * 60_000);
  const report = await runEmailDispatch(deps);
  assert.equal(report.outbox?.sent, 1);
  assert.equal(store.schedulerRuns.length, 1);

  store.failures.set("loadSettings", new Error("db down"));
  const broken = await runEmailDispatch(deps);
  assert.deepEqual(broken.errors, ["settings"]);
  assert.notEqual(broken.outbox, null);
});

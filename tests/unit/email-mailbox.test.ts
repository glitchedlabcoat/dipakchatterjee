// Admin > Emails sections: Drafts, Outbox, Sent and Trashed, through the
// real server actions and outbox against the in-memory store and a fake
// Resend. Covers draft persistence and concurrent edits, exactly-once
// sending, failure and retry, the trash rules and retention. Next.js, the
// admin guard and the database are mocked; nothing leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mockModule } from "@/tests/unit/helpers/mock-module";

process.env.RESEND_FROM_EMAIL = "Dipak Chatterjee <office@janatardipak.com>";
process.env.RESEND_API_KEY = "re_TEST_not_real";

const { MemoryStore } = await import("@/tests/unit/helpers/memory-store");
const { FakeSender, permanentError, transientError } = await import("@/tests/unit/helpers/fake-sender");

type Runtime = { store: InstanceType<typeof MemoryStore>; send: InstanceType<typeof FakeSender>["send"] | null; fetchReceived: null };
let runtime: Runtime;
let sender: InstanceType<typeof FakeSender>;
function fresh() {
  const store = new MemoryStore({ settings: { officeNotificationEmail: "dipak@example.org" } });
  sender = new FakeSender();
  runtime = { store, send: sender.send, fetchReceived: null };
  return store;
}
fresh();

const ADMIN = { id: "00000000-0000-4000-8000-0000000000aa", email: "colleague@example.org" };
mockModule("next/server", { NextResponse: { json: (b: unknown, i?: ResponseInit) => Response.json(b, i) }, after: () => undefined });
mockModule("next/cache", { revalidatePath: () => undefined });
mockModule("@/lib/email/runtime", { createEmailRuntime: () => runtime });
mockModule("@/lib/admin-guard", {
  requireAdmin: async () => ({ supabase: {}, user: ADMIN }),
  requireOwner: async () => {
    throw new Error("the Emails section must not use the owner-only guard");
  },
  requireProfile: async () => ({ supabase: {}, user: ADMIN, profile: { is_admin: false } }),
});
mockModule("@/lib/activity-log", { logDashboardActivity: async () => undefined });
mockModule("@/utils/supabase/admin", { createServiceClient: () => ({}) });

const actions = await import("@/app/admin/(protected)/emails/actions");
const { processDueMessages, deliverMessage } = await import("@/lib/email/outbox");
const { runEmailDispatch } = await import("@/lib/email/dispatch");
const { folderOf, messageTrashBlockedReason, draftRecipientsFromInput, MAX_SUBJECT } = await import("@/lib/email/mailbox");

const draftInput = (over: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  to: "a@example.com",
  subject: "Road repair update",
  body: "Work starts on Monday.",
  ...over,
});

// --- Section rules ----------------------------------------------------------

test("every message lands in exactly one section", () => {
  const base = { kind: "compose", status: "pending", sent_at: null, trashed_at: null };
  assert.equal(folderOf({ ...base, status: "draft" }), "drafts");
  for (const status of ["pending", "sending", "failed", "skipped"]) assert.equal(folderOf({ ...base, status }), "outbox", status);
  for (const status of ["sent", "delivered", "delivery_delayed", "bounced", "complained", "suppressed", "failed"]) {
    assert.equal(folderOf({ ...base, status, sent_at: "2026-10-18T00:00:00Z" }), "sent", status);
  }
  assert.equal(folderOf({ ...base, status: "sent", sent_at: "x", trashed_at: "y" }), "trash");
  assert.equal(folderOf({ ...base, kind: "reply", status: "sent", sent_at: "x" }), "sent");
  for (const kind of ["complaint_receipt", "office_notification", "reminder"]) {
    assert.equal(folderOf({ ...base, kind, status: "sent", sent_at: "x" }), "system", "system emails stay out of the sections");
  }
});

test("a message the outbox is still working on can't be trashed", () => {
  assert.match(messageTrashBlockedReason({ kind: "compose", status: "pending", trashed_at: null }) ?? "", /still being sent/);
  assert.match(messageTrashBlockedReason({ kind: "compose", status: "sending", trashed_at: null }) ?? "", /still being sent/);
  assert.match(messageTrashBlockedReason({ kind: "complaint_receipt", status: "sent", trashed_at: null }) ?? "", /System emails/);
  assert.equal(messageTrashBlockedReason({ kind: "compose", status: "failed", trashed_at: null }), null);
  assert.equal(messageTrashBlockedReason({ kind: "compose", status: "draft", trashed_at: null }), null);
});

test("an unfinished To field survives a save, bounded", () => {
  assert.deepEqual(draftRecipientsFromInput("a@example.com, half-typed@ ;\nb@example.com"), ["a@example.com", "half-typed@", "b@example.com"]);
  assert.equal(draftRecipientsFromInput(Array.from({ length: 80 }, (_, i) => `u${i}@x.io`).join(",")).length, 50);
  assert.deepEqual(draftRecipientsFromInput("evil\u0000@x.io\u0007"), ["evil@x.io"]);
});

// --- Drafts -------------------------------------------------------------------

test("drafts persist in the database, reopen intact, and are never sent or counted on their own", async () => {
  const store = fresh();
  const input = draftInput({ to: "a@example.com, not-finished@", subject: "नमस्ते 👋 ‮RTL‬", body: "Line 1\r\nLine 2" });
  const saved = await actions.saveDraft(input);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const row = store.messages.get(saved.draftId)!;
  assert.equal(row.status, "draft");
  assert.equal(row.kind, "compose");
  assert.equal(row.queued_at, null, "a draft isn't queued");
  assert.deepEqual(row.to_addresses, ["a@example.com", "not-finished@"]);
  assert.equal(row.subject, "नमस्ते 👋 ‮RTL‬", "Unicode kept; only control characters stripped");
  assert.equal(row.body_text, "Line 1\nLine 2");

  // The outbox and the scheduler never touch a draft.
  await processDueMessages({ store, send: sender.send });
  await runEmailDispatch({ store, send: sender.send, fetchReceived: null });
  assert.equal(sender.calls.length, 0);
  assert.equal(store.messages.get(saved.draftId)!.status, "draft");
  assert.equal(await store.countMessagesSince(["compose", "reply"], new Date(0).toISOString()), 0, "drafts don't use the send limit");

  // Reopen (fresh read), edit, save again with the version we loaded.
  const reopened = await store.getMessage(saved.draftId);
  const again = await actions.saveDraft({ ...input, draftId: saved.draftId, expectedUpdatedAt: reopened!.updated_at, body: "Edited" });
  assert.equal(again.ok, true);
  assert.equal(store.messages.get(saved.draftId)!.body_text, "Edited");
  assert.equal(store.messageList().length, 1, "edited in place, not duplicated");
});

test("a stale draft (saved elsewhere in the meantime) is not overwritten", async () => {
  const store = fresh();
  const first = await actions.saveDraft(draftInput());
  assert.ok(first.ok);
  if (!first.ok) return;
  const loadedVersion = first.updatedAt;

  // Another tab or administrator saves a newer version.
  await new Promise((r) => setTimeout(r, 5));
  const other = await actions.saveDraft({ ...draftInput(), draftId: first.draftId, expectedUpdatedAt: loadedVersion, body: "Newer" });
  assert.ok(other.ok);

  const stale = await actions.saveDraft({ ...draftInput(), draftId: first.draftId, expectedUpdatedAt: loadedVersion, body: "Older" });
  assert.equal(stale.ok, false);
  assert.match(stale.ok ? "" : stale.error, /changed in another tab or by another administrator/);
  assert.equal(store.messages.get(first.draftId)!.body_text, "Newer");

  const staleSend = await actions.sendComposedEmail({ ...draftInput(), draftId: first.draftId, expectedUpdatedAt: loadedVersion });
  assert.equal(staleSend.ok, false, "a stale send is refused too");
  assert.equal(sender.calls.length, 0);
});

test("two quick Saves of a new draft make one draft, and an empty draft isn't saved", async () => {
  const store = fresh();
  const input = draftInput();
  const [a, b] = await Promise.all([actions.saveDraft(input), actions.saveDraft({ ...input, body: "second" })]);
  assert.ok(a.ok && b.ok);
  assert.equal(store.messageList().length, 1);
  assert.equal(a.ok && b.ok && a.draftId === b.draftId, true);

  const empty = await actions.saveDraft(draftInput({ to: " ", subject: "", body: "  " }));
  assert.equal(empty.ok, false);
  assert.equal(store.messageList().length, 1);

  const long = await actions.saveDraft(draftInput({ body: "x".repeat(20_001) }));
  assert.equal(long.ok, false);
});

test("sending a draft validates it, sends it exactly once, and moves it from Drafts to Sent", async () => {
  const store = fresh();
  const input = draftInput({ to: "a@example.com, not-finished@" });
  const saved = await actions.saveDraft(input);
  assert.ok(saved.ok);
  if (!saved.ok) return;

  const invalid = await actions.sendComposedEmail({ ...input, draftId: saved.draftId, expectedUpdatedAt: saved.updatedAt });
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? "" : invalid.error, /not a valid email address/);
  assert.equal(store.messages.get(saved.draftId)!.status, "draft", "still a draft after a validation error");

  const fixed = { ...input, to: "a@example.com, A@example.com, b@example.com", draftId: saved.draftId, expectedUpdatedAt: saved.updatedAt };
  const results = await Promise.all([actions.sendComposedEmail(fixed), actions.sendComposedEmail(fixed), actions.sendComposedEmail(fixed)]);
  assert.equal(results.filter((r) => r.ok).length, 1, "only one of three concurrent Sends goes through");
  assert.equal(sender.calls.length, 1);
  assert.equal(sender.calls[0].key, `compose:${input.requestId}`, "idempotency key is the draft's dedupe key");
  assert.deepEqual(sender.calls[0].email.to, ["a@example.com", "b@example.com"], "duplicate recipients collapsed");

  const row = store.messages.get(saved.draftId)!;
  assert.equal(folderOf(row), "sent");
  assert.ok(row.queued_at && row.sent_at && row.provider_message_id);

  const late = await actions.saveDraft({ ...input, draftId: saved.draftId, expectedUpdatedAt: row.updated_at, body: "too late" });
  assert.equal(late.ok, false, "a sent message can't be edited as a draft");
  assert.match(late.ok ? "" : late.error, /already been sent/);
});

test("a trashed draft can't be sent or edited until it is restored", async () => {
  const store = fresh();
  const saved = await actions.saveDraft(draftInput());
  assert.ok(saved.ok);
  if (!saved.ok) return;
  assert.deepEqual(await actions.moveToTrash({ id: saved.draftId, type: "message" }), { ok: true });
  assert.equal(folderOf(store.messages.get(saved.draftId)!), "trash");

  const send = await actions.sendComposedEmail({ ...draftInput(), draftId: saved.draftId });
  assert.equal(send.ok, false);
  assert.match(send.ok ? "" : send.error, /in Trashed/);
  assert.equal(sender.calls.length, 0);

  assert.deepEqual(await actions.restoreFromTrash({ id: saved.draftId, type: "message" }), { ok: true });
  assert.equal(folderOf(store.messages.get(saved.draftId)!), "drafts", "restored to Drafts");
});

// --- New Message, Outbox and Sent -------------------------------------------------

test("New Message reports success only after Resend accepts; otherwise it is durably in the Outbox", async () => {
  const store = fresh();
  sender.respond(transientError);
  const queued = await actions.sendComposedEmail(draftInput());
  assert.equal(queued.ok, true);
  assert.equal(queued.ok && queued.status, "queued", "not reported as sent");
  if (!queued.ok) return;
  const row = store.messages.get(queued.id)!;
  assert.equal(folderOf(row), "outbox");
  assert.equal(row.status, "pending");
  assert.ok(Date.parse(row.next_attempt_at) > Date.now(), "retry scheduled with backoff");

  // The scheduler retries with the same idempotency key and payload.
  await deliverMessage({ store, send: sender.send }, row.id, { force: true });
  assert.equal(store.messages.get(row.id)!.status, "sent");
  assert.equal(sender.delivered.length, 1);
  assert.equal(new Set(sender.calls.map((c) => c.key)).size, 1);

  sender.respond(permanentError);
  const failed = await actions.sendComposedEmail(draftInput());
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? "" : failed.error, /Sending failed: validation_error.*in the Outbox/);
  const failedRow = store.messageList().find((m) => m.status === "failed")!;
  assert.equal(folderOf(failedRow), "outbox");

  // Retry from the Outbox re-sends the same message once.
  const retried = await actions.retryEmailMessage({ id: failedRow.id });
  assert.deepEqual(retried, { ok: true, status: "sent" });
  assert.equal(folderOf(store.messages.get(failedRow.id)!), "sent");
});

test("a resubmitted New Message (same composition) is not sent twice", async () => {
  fresh();
  const input = draftInput();
  const first = await actions.sendComposedEmail(input);
  const second = await actions.sendComposedEmail(input);
  assert.ok(first.ok);
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, /already submitted/);
  assert.equal(sender.calls.length, 1);
});

test("without RESEND_API_KEY nothing is queued and the composer says why", async () => {
  const store = fresh();
  runtime.send = null;
  const r = await actions.sendComposedEmail(draftInput());
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /RESEND_API_KEY/);
  assert.equal(store.messageList().length, 0);
});

test("the shared send limit counts when a message is queued, so stockpiled drafts can't exceed it", async () => {
  const store = fresh();
  const drafts = [];
  for (let i = 0; i < 21; i++) {
    const d = await actions.saveDraft(draftInput());
    assert.ok(d.ok);
    if (d.ok) drafts.push(d);
  }
  // Pretend the drafts were written long ago.
  for (const m of store.messages.values()) m.created_at = "2026-01-01T00:00:00.000Z";
  let refused = 0;
  for (const d of drafts) {
    const r = await actions.sendComposedEmail({ ...draftInput(), draftId: d.draftId, expectedUpdatedAt: d.updatedAt });
    if (!r.ok && /Sending limit reached/.test(r.error)) refused += 1;
  }
  assert.equal(sender.calls.length, 20, "20 per hour across all administrators");
  assert.equal(refused, 1);
});

test("subject and body limits apply on send; header injection is neutralised", async () => {
  fresh();
  assert.equal((await actions.sendComposedEmail(draftInput({ subject: "s".repeat(MAX_SUBJECT + 1) }))).ok, false);
  assert.equal((await actions.sendComposedEmail(draftInput({ body: "b".repeat(20_001) }))).ok, false);
  assert.equal((await actions.sendComposedEmail(draftInput({ to: "" }))).ok, false);
  const ok = await actions.sendComposedEmail(draftInput({ subject: "Hello\r\nBcc: x@evil.test", body: "<script>alert(1)</script>" }));
  assert.ok(ok.ok);
  const sent = sender.calls.at(-1)!.email;
  assert.equal(sent.subject, "Hello Bcc: x@evil.test");
  assert.ok(!sent.html.includes("<script>"), "body is escaped into the HTML part");
  assert.equal(sent.from, '"Dipak Chatterjee" <office@janatardipak.com>', "sender is fixed server-side");
});

// --- Trashed ----------------------------------------------------------------------

test("Trashed is a soft delete with restore, and never applies to a message still being sent", async () => {
  const store = fresh();
  sender.respond(transientError);
  const queued = await actions.sendComposedEmail(draftInput());
  assert.ok(queued.ok);
  if (!queued.ok) return;
  const blocked = await actions.moveToTrash({ id: queued.id, type: "message" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.error, /still being sent/);

  await deliverMessage({ store, send: sender.send }, queued.id, { force: true });
  assert.deepEqual(await actions.moveToTrash({ id: queued.id, type: "message" }), { ok: true });
  const trashed = store.messages.get(queued.id)!;
  assert.equal(folderOf(trashed), "trash");
  assert.equal(trashed.trashed_by, ADMIN.id);
  assert.equal(store.messageList().length, 1, "nothing deleted");
  assert.equal((await actions.moveToTrash({ id: queued.id, type: "message" })).ok, false, "already in Trashed");

  assert.deepEqual(await actions.restoreFromTrash({ id: queued.id, type: "message" }), { ok: true });
  assert.equal(folderOf(store.messages.get(queued.id)!), "sent", "restored to where it was");
  assert.equal((await actions.restoreFromTrash({ id: queued.id, type: "message" })).ok, false);
});

test("a trashed message is never sent, even by a stale Retry or the scheduler", async () => {
  const store = fresh();
  sender.respond(permanentError);
  await actions.sendComposedEmail(draftInput());
  const failed = store.messageList()[0];
  assert.equal(failed.status, "failed");
  assert.deepEqual(await actions.moveToTrash({ id: failed.id, type: "message" }), { ok: true });

  const retry = await actions.retryEmailMessage({ id: failed.id });
  assert.equal(retry.ok, false);
  assert.match(retry.ok ? "" : retry.error, /in Trashed/);

  // Even if something put it back to pending, the claim refuses trashed rows.
  await store.updateMessage(failed.id, { status: "pending", next_attempt_at: new Date(0).toISOString() });
  await processDueMessages({ store, send: sender.send });
  assert.equal(sender.delivered.length, 0);
});

test("system emails can't be moved to Trashed through the actions", async () => {
  const store = fresh();
  const { id } = await store.insertMessage({ kind: "complaint_receipt", dedupeKey: "complaint-receipt:x", toAddresses: ["c@example.com"] });
  await store.updateMessage(id, { status: "sent", sent_at: new Date().toISOString() });
  const r = await actions.moveToTrash({ id, type: "message" });
  assert.equal(r.ok, false);
  assert.equal(store.messages.get(id)!.trashed_at, null);
});

test("received mail moves to Trashed and back; a replayed webhook doesn't un-trash it", async () => {
  const store = fresh();
  const event = { provider_email_id: "re_in_1", from_address: "ram@example.com", to_addresses: ["office@janatardipak.com"], received_at: new Date().toISOString() };
  const { id } = await store.insertInbound(event);
  assert.deepEqual(await actions.moveToTrash({ id, type: "inbound" }), { ok: true });
  const replay = await store.insertInbound(event);
  assert.equal(replay.inserted, false);
  assert.ok(store.inbound.get(id)!.trashed_at, "still trashed after the duplicate event");
  assert.deepEqual(await actions.restoreFromTrash({ id, type: "inbound" }), { ok: true });
  assert.equal(store.inbound.get(id)!.trashed_at, null);
  assert.equal((await actions.moveToTrash({ id: randomUUID(), type: "inbound" })).ok, false, "unknown id");
  assert.equal((await actions.moveToTrash({ id: "../etc/passwd", type: "inbound" })).ok, false, "malformed id");
});

// --- Retention ----------------------------------------------------------------------

test("retention never deletes drafts, keeps correspondence a year, and ignores Trashed", async () => {
  const store = fresh();
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const veryOld = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const add = async (kind: "compose" | "reply" | "test" | "complaint_receipt", status: string, created: string, trashed = false) => {
    const { id } = await store.insertMessage({ kind, dedupeKey: randomUUID(), toAddresses: ["a@example.com"], status: status === "draft" ? "draft" : "pending" });
    // A pending row waits for a later retry, so the tick's outbox step leaves it alone.
    const nextAttempt = new Date(Date.now() + 3_600_000).toISOString();
    await store.updateMessage(id, { status, created_at: created, trashed_at: trashed ? created : null, next_attempt_at: nextAttempt });
    return id;
  };
  const draft = await add("compose", "draft", veryOld);
  const sent100 = await add("compose", "sent", old, true);
  const sent400 = await add("compose", "sent", veryOld);
  const receipt100 = await add("complaint_receipt", "sent", old);
  const test100 = await add("test", "sent", old);
  const pending400 = await add("reply", "pending", veryOld);

  await runEmailDispatch({ store, send: null, fetchReceived: null });
  assert.ok(store.messages.has(draft), "drafts are never purged");
  assert.ok(store.messages.has(sent100), "sent correspondence kept for 365 days, trashed or not");
  assert.ok(!store.messages.has(sent400), "correspondence older than 365 days goes");
  assert.ok(!store.messages.has(receipt100), "system emails go after 90 days");
  assert.ok(!store.messages.has(test100));
  assert.ok(store.messages.has(pending400), "never while still in the outbox");
});

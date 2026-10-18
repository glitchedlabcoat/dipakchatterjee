// The public edges of the email system: the Resend webhook route, the
// cron route and the admin server actions (authorization, validation,
// duplicate protection, no secrets in responses), plus the Supabase
// store's query filters. Next.js, the admin guard and the database are
// mocked; nothing leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mockModule } from "@/tests/unit/helpers/mock-module";

const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const API_KEY = "re_TEST_SECRET_must_never_appear";
const CRON = "cron-secret-must-never-appear";
process.env.RESEND_FROM_EMAIL = "Dipak Chatterjee <office@janatardipak.com>";
process.env.RESEND_API_KEY = API_KEY;
process.env.CRON_SECRET = CRON;
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { MemoryStore } = await import("@/tests/unit/helpers/memory-store");
const { FakeSender } = await import("@/tests/unit/helpers/fake-sender");
const { computeWebhookSignature } = await import("@/lib/email/webhook-signature");

type Runtime = { store: InstanceType<typeof MemoryStore>; send: InstanceType<typeof FakeSender>["send"]; fetchReceived: null };
let runtime: Runtime;
let sender: InstanceType<typeof FakeSender>;
function fresh(settings: Record<string, unknown> = {}) {
  const store = new MemoryStore({ settings: { officeNotificationEmail: "dipak@example.org", ...settings } });
  sender = new FakeSender();
  runtime = { store, send: sender.send, fetchReceived: null };
  return store;
}
fresh();

const afterQueue: (() => unknown)[] = [];
// "owner": the ADMIN profile. "admin": a USER-role profile, i.e. any other
// dashboard administrator. "noprofile": signed in to Supabase but no
// dashboard profile (requireAdmin throws Forbidden). "anon": no session.
let viewer: "owner" | "admin" | "noprofile" | "anon" = "owner";
const guard = (ownerOnly: boolean) => async () => {
  if (ownerOnly) ownerGuardCalls += 1;
  if (viewer === "anon") throw new Error("Unauthorized");
  if (viewer === "noprofile") throw new Error("Forbidden");
  if (ownerOnly && viewer !== "owner") throw new Error("Forbidden");
  const email = viewer === "owner" ? "owner@example.org" : "colleague@example.org";
  return { supabase: {}, user: { id: "00000000-0000-4000-8000-000000000001", email } };
};
let ownerGuardCalls = 0;
const upserts: unknown[] = [];

mockModule("next/server", {
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
  after: (fn: () => unknown) => void afterQueue.push(fn),
});
mockModule("next/cache", { revalidatePath: () => undefined });
mockModule("@/lib/email/runtime", { createEmailRuntime: () => runtime });
mockModule("@/lib/admin-guard", { requireAdmin: guard(false), requireOwner: guard(true), requireProfile: guard(false) });
mockModule("@/lib/activity-log", { logDashboardActivity: async () => undefined });
mockModule("@/utils/supabase/admin", {
  createServiceClient: () => ({
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        upserts.push({ table, row });
        return { error: null };
      },
    }),
  }),
});

const webhook = await import("@/app/api/webhooks/resend/route");
const cron = await import("@/app/api/cron/email/route");
const actions = await import("@/app/admin/(protected)/emails/actions");

const secretsIn = (value: unknown) => {
  const text = JSON.stringify(value);
  return [API_KEY, CRON, WEBHOOK_SECRET].some((s) => text.includes(s));
};

function webhookRequest(event: unknown, opts: { tamper?: boolean; size?: number } = {}) {
  const body = opts.size ? "x".repeat(opts.size) : JSON.stringify(event);
  const id = `msg_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${computeWebhookSignature(WEBHOOK_SECRET, id, ts, body)}`;
  return new Request("https://janatardipak.com/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": signature, "content-type": "application/json" },
    body: opts.tamper ? body.replace("Road", "Rood") : body,
  });
}

const received = {
  type: "email.received",
  created_at: new Date().toISOString(),
  data: {
    email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    from: "Ram <ram@example.com>",
    to: ["office@janatardipak.com"],
    subject: "Road repair",
    message_id: "<abc@mail.example.com>",
    attachments: [],
  },
};

// --- Webhook -----------------------------------------------------------------

test("webhook: disabled without a secret, rejects forged/oversized requests, stores mail once", async () => {
  const store = fresh();
  delete process.env.RESEND_WEBHOOK_SECRET;
  assert.equal((await webhook.POST(webhookRequest(received))).status, 404);
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;

  assert.equal((await webhook.POST(webhookRequest(received, { tamper: true }))).status, 401);
  const unsigned = new Request("https://janatardipak.com/api/webhooks/resend", { method: "POST", body: JSON.stringify(received) });
  assert.equal((await webhook.POST(unsigned)).status, 401);
  assert.equal((await webhook.POST(webhookRequest(null, { size: 300 * 1024 }))).status, 413);
  assert.equal(store.inbound.size, 0);

  const first = await webhook.POST(webhookRequest(received));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, result: "stored" });
  const replay = await webhook.POST(webhookRequest(received));
  assert.deepEqual(await replay.json(), { ok: true, result: "duplicate" });
  assert.equal(store.inbound.size, 1);
  assert.equal(afterQueue.length, 1, "body fetch scheduled once");
  afterQueue.length = 0;
});

test("webhook: delivery events update the matching sent message", async () => {
  const store = fresh();
  const { id } = await store.insertMessage({ kind: "test", dedupeKey: "t", toAddresses: ["a@example.com"] });
  await store.updateMessage(id, { status: "sent", provider_message_id: "re_77" });
  const res = await webhook.POST(webhookRequest({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "re_77" } }));
  assert.deepEqual(await res.json(), { ok: true, result: "updated" });
  assert.equal(store.messages.get(id)!.status, "bounced");
});

// --- Cron ----------------------------------------------------------------------

test("cron: 404 without CRON_SECRET, 401 with a wrong token, counts only on success", async () => {
  fresh();
  delete process.env.CRON_SECRET;
  assert.equal((await cron.GET(new Request("https://x/api/cron/email"))).status, 404);
  process.env.CRON_SECRET = CRON;
  const wrong = new Request("https://x/api/cron/email", { headers: { authorization: "Bearer nope" } });
  assert.equal((await cron.POST(wrong)).status, 401);
  const ok = await cron.POST(new Request("https://x/api/cron/email", { headers: { authorization: `Bearer ${CRON}` } }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(Object.keys(body).sort(), ["errors", "inboundBodiesFetched", "outbox", "purged", "reminder"]);
  assert.equal(secretsIn(body), false);
});

// --- Admin actions -------------------------------------------------------------

const settingsInput = {
  senderName: "Dipak Chatterjee",
  senderAddress: "",
  replyTo: "",
  officeNotificationEmail: "dipak@example.org",
  citizenConfirmationEnabled: true,
  officeNotificationEnabled: true,
  remindersEnabled: true,
  schedule: { frequency: "weekly" as const, time: "09:00", timezone: "Asia/Kolkata", weekday: 1, monthDay: 1, interval: 7, startDate: "2026-10-17" },
};

/** One call of every exported Emails action, against fresh fixtures. */
async function callEveryAction(store: InstanceType<typeof MemoryStore>) {
  const { id: inboundId } = await store.insertInbound({ provider_email_id: `p-${randomUUID()}`, from_address: "ram@example.com", received_at: new Date().toISOString() });
  const { id: failedId } = await store.insertMessage({
    kind: "test",
    dedupeKey: `f-${randomUUID()}`,
    toAddresses: ["a@example.com"],
    status: "skipped",
    fromHeader: "office@janatardipak.com",
    subject: "Test",
    bodyText: "Test",
    bodyHtml: "<p>Test</p>",
  });
  const { id: draftId } = await store.insertMessage({ kind: "compose", dedupeKey: `compose:${randomUUID()}`, toAddresses: ["a@example.com"], status: "draft", subject: "Draft", bodyText: "Body" });
  const { id: sentId } = await store.insertMessage({ kind: "compose", dedupeKey: `compose:${randomUUID()}`, toAddresses: ["a@example.com"] });
  await store.updateMessage(sentId, { status: "sent", sent_at: new Date().toISOString() });
  return {
    saveEmailSettings: await actions.saveEmailSettings(settingsInput),
    sendTestEmail: await actions.sendTestEmail(),
    saveDraft: await actions.saveDraft({ requestId: randomUUID(), to: "b@example.com", subject: "New draft", body: "Text" }),
    sendComposedEmail: await actions.sendComposedEmail({ requestId: randomUUID(), to: "a@example.com", subject: "Hi", body: "Hello" }),
    sendReply: await actions.sendReply({ requestId: randomUUID(), inboundId, body: "Hello" }),
    setInboundRead: await actions.setInboundRead({ id: inboundId, isRead: true }),
    retryEmailMessage: await actions.retryEmailMessage({ id: failedId }),
    moveToTrash: await actions.moveToTrash({ id: sentId, type: "message" }),
    restoreFromTrash: await actions.restoreFromTrash({ id: sentId, type: "message" }),
    moveDraftToTrash: await actions.moveToTrash({ id: draftId, type: "message" }),
    moveInboundToTrash: await actions.moveToTrash({ id: inboundId, type: "inbound" }),
  };
}

test("every Emails action is covered here (no unlisted action can skip the access checks)", async () => {
  const listed = ["saveEmailSettings", "sendTestEmail", "saveDraft", "sendComposedEmail", "sendReply", "setInboundRead", "retryEmailMessage", "moveToTrash", "restoreFromTrash"];
  const exported = Object.entries(actions).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
  assert.deepEqual(exported, [...listed].sort());
});

test("unauthenticated callers and accounts without a dashboard profile can't use any Emails action", async () => {
  for (const who of ["anon", "noprofile"] as const) {
    const store = fresh();
    upserts.length = 0;
    const before = { messages: store.messageList().length };
    viewer = who;
    let results: Record<string, { ok: boolean; error?: string }>;
    try {
      results = await callEveryAction(store);
    } finally {
      viewer = "owner";
    }
    for (const [name, r] of Object.entries(results)) {
      assert.equal(r.ok, false, `${who}: ${name} must be refused`);
      assert.match(r.error ?? "", who === "anon" ? /session has expired/ : /doesn't have access/, `${who}: ${name}`);
    }
    assert.equal(sender.calls.length, 0, `${who}: nothing sent`);
    assert.equal(upserts.length, 0, `${who}: no settings written`);
    // Only the fixtures callEveryAction itself inserted exist; nothing was trashed, read or queued.
    assert.equal(store.messageList().length, before.messages + 3);
    assert.ok(store.messageList().every((m) => m.trashed_at === null));
    assert.ok([...store.inbound.values()].every((m) => !m.is_read && m.trashed_at === null));
  }
});

test("every dashboard administrator (not just the ADMIN owner) has full access to the Emails section", async () => {
  const store = fresh();
  upserts.length = 0;
  ownerGuardCalls = 0;
  viewer = "admin";
  let results: Record<string, { ok: boolean; error?: string }>;
  try {
    results = await callEveryAction(store);
  } finally {
    viewer = "owner";
  }
  for (const [name, r] of Object.entries(results)) assert.equal(r.ok, true, `${name}: ${r.error ?? ""}`);
  assert.equal(ownerGuardCalls, 0, "no Emails action uses the owner-only guard");
  assert.equal(upserts.length, 1, "settings saved");
  // Test email goes to the signed-in administrator's own address.
  assert.ok(sender.calls.some((c) => c.email.to.length === 1 && c.email.to[0] === "colleague@example.org"));
});

test("composer validates recipients and content, sends once per draft, and never echoes secrets", async () => {
  const store = fresh();
  const base = { requestId: randomUUID(), to: "a@example.com", subject: "Meeting", body: "Hello" };
  const invalid = [
    { ...base, to: "not-an-email" },
    { ...base, to: Array.from({ length: 11 }, (_, i) => `u${i}@example.com`).join(",") },
    { ...base, subject: "   " },
    { ...base, body: "" },
    { ...base, body: "x".repeat(20_001) },
    { ...base, requestId: "not-a-uuid" },
  ];
  for (const input of invalid) {
    const r = await actions.sendComposedEmail(input);
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 80));
  }
  assert.equal(sender.calls.length, 0);

  const ok = await actions.sendComposedEmail({ ...base, to: "a@example.com, B@example.com", subject: "Line\r\nBcc: evil@x.com" });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.status, "sent", "reported as sent only after Resend accepted it");
  assert.equal(ok.ok && ok.recipients, 2);
  assert.equal(sender.calls[0].email.subject, "Line Bcc: evil@x.com");
  assert.deepEqual(sender.calls[0].email.to, ["a@example.com", "B@example.com"]);

  const again = await actions.sendComposedEmail({ ...base, to: "a@example.com, B@example.com" });
  assert.equal(again.ok, false);
  assert.equal(sender.calls.length, 1, "a resubmitted draft is not sent twice");
  assert.equal(store.messageList().length, 1);
  assert.equal(secretsIn([ok, again]), false);
});

test("reply threads on a valid Message-ID and drops an injected one", async () => {
  const store = fresh();
  const good = await store.insertInbound({
    provider_email_id: "p-good",
    from_address: "ram@example.com",
    reply_to_addresses: ["reply@example.com"],
    subject: "Road repair",
    message_id: "<abc@mail.example.com>",
    received_at: new Date().toISOString(),
  });
  const r1 = await actions.sendReply({ requestId: randomUUID(), inboundId: good.id, body: "We are looking into it." });
  assert.deepEqual(r1, { ok: true, status: "sent", to: "reply@example.com" });
  assert.equal(sender.calls[0].email.subject, "Re: Road repair");
  assert.deepEqual(sender.calls[0].email.headers, { "In-Reply-To": "<abc@mail.example.com>", References: "<abc@mail.example.com>" });

  const bad = await store.insertInbound({
    provider_email_id: "p-bad",
    from_address: "x@example.com",
    message_id: "<a@b>\r\nBcc: victim@example.com",
    received_at: new Date().toISOString(),
  });
  await actions.sendReply({ requestId: randomUUID(), inboundId: bad.id, body: "Hi" });
  assert.equal(sender.calls[1].email.headers, null);
  assert.deepEqual(sender.calls[1].email.to, ["x@example.com"]);
});

test("settings save validates, records the schedule change time, and returns no secrets", async () => {
  fresh({ persisted: true });
  upserts.length = 0;
  const bad = await actions.saveEmailSettings({ ...settingsInput, senderAddress: "me@gmail.com" });
  assert.equal(bad.ok, false);
  assert.equal(upserts.length, 0);

  const ok = await actions.saveEmailSettings(settingsInput);
  assert.equal(ok.ok, true);
  assert.equal(upserts.length, 1);
  const row = (upserts[0] as { row: Record<string, unknown> }).row;
  assert.equal(row.reminders_enabled, true);
  assert.equal(row.office_notification_email, "dipak@example.org");
  assert.ok(Date.now() - Date.parse(String(row.reminder_schedule_updated_at)) < 5000);
  assert.equal(secretsIn([ok, row]), false);
});

test("test email goes only to the signed-in administrator's own address", async () => {
  fresh();
  const r = await actions.sendTestEmail();
  assert.deepEqual(r, { ok: true, to: "owner@example.org" });
  assert.deepEqual(sender.calls[0].email.to, ["owner@example.org"]);
});

// --- Supabase store query shape -----------------------------------------------

test("the Supabase store applies the unresolved/claim/dedupe rules in its queries", async () => {
  const { createSupabaseEmailStore } = await import("@/lib/email/store");
  const calls: unknown[][] = [];
  const result = { data: [], count: 0, error: null };
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
        return (...args: unknown[]) => {
          calls.push([prop, ...args]);
          return builder;
        };
      },
    }
  );
  const db = { from: (table: string) => (calls.push(["from", table]), builder) };
  const store = createSupabaseEmailStore(db as never);

  const now = new Date().toISOString();
  await store.listUnresolvedComplaints(now, 50);
  assert.deepEqual(calls.slice(0, 7).map((c) => c[0]), ["from", "select", "neq", "eq", "gt", "order", "limit"]);
  assert.deepEqual(calls[2], ["neq", "status", "resolved"]);
  assert.deepEqual(calls[3], ["eq", "is_expired", false]);
  assert.deepEqual(calls[4], ["gt", "expires_at", now]);

  calls.length = 0;
  await store.claimMessage({ id: "m1", status: "pending", attempts: 2 } as never, { status: "sending" });
  assert.deepEqual(calls.filter((c) => c[0] === "eq"), [["eq", "id", "m1"], ["eq", "status", "pending"], ["eq", "attempts", 2]]);

  calls.length = 0;
  (result as { data: unknown }).data = [{ id: "new" }];
  await store.insertMessage({ kind: "test", dedupeKey: "k", toAddresses: [] });
  const upsert = calls.find((c) => c[0] === "upsert");
  assert.deepEqual(upsert?.[2], { onConflict: "dedupe_key", ignoreDuplicates: true });
});

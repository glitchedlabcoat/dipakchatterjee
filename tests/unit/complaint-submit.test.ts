// submitComplaint() end to end with the email system attached: the
// optional email field, the receipt/notification queueing, and the rule
// that nothing on the email side can fail or undo a saved complaint.
// Supabase, R2, Next.js request APIs and Resend are mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mockModule } from "@/tests/unit/helpers/mock-module";

process.env.RESEND_FROM_EMAIL = "Dipak Chatterjee <office@janatardipak.com>";

const { MemoryStore } = await import("@/tests/unit/helpers/memory-store");
const { FakeSender, permanentError } = await import("@/tests/unit/helpers/fake-sender");

let store: InstanceType<typeof MemoryStore>;
let sender: InstanceType<typeof FakeSender>;
const afterQueue: (() => unknown)[] = [];
const inserted: Record<string, unknown>[] = [];
const insertErrors: ({ code: string; message: string } | null)[] = [];
let ipCounter = 0;

function fresh(settings: Record<string, unknown> = {}) {
  store = new MemoryStore({ settings: { officeNotificationEmail: "dipak@example.org", ...settings } });
  sender = new FakeSender();
  afterQueue.length = 0;
  inserted.length = 0;
  insertErrors.length = 0;
  ipCounter += 1;
}
fresh();

const fakeDb = {
  from(table: string) {
    if (table === "site_settings") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { complaint_expiration_days: 7 }, error: null }) }) }) };
    }
    if (table === "complaints") {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const error = insertErrors.shift();
              if (error) return { data: null, error };
              const id = randomUUID();
              inserted.push({ id, ...row });
              store.addComplaint({ id, contact_email: (row.contact_email as string | undefined) ?? null });
              return { data: { id }, error: null };
            },
          }),
        }),
      };
    }
    return { insert: async () => ({ error: null }) };
  },
};

// Each test gets its own visitor address, so the module-level rate limiter
// doesn't carry over between tests; requestHeaders overrides it.
let requestHeaders: (() => Record<string, string>) | null = null;
mockModule("next/headers", {
  headers: async () => new Headers(requestHeaders ? requestHeaders() : { "cf-connecting-ip": `10.0.0.${ipCounter}` }),
});
mockModule("next/cache", { revalidatePath: () => undefined });
mockModule("next/server", { after: (fn: () => unknown) => void afterQueue.push(fn) });
mockModule("@/utils/supabase/admin", { createServiceClient: () => fakeDb });
mockModule("@/lib/r2-complaints", { headComplaintObject: async () => ({ ContentLength: 1 }), R2_COMPLAINT_KEY_PREFIX: "r2-media/" });
mockModule("@/lib/email/runtime", { createEmailRuntime: () => ({ store, send: sender.send, fetchReceived: null }) });

const { submitComplaint } = await import("@/app/(site)/complaints/actions");

const form = (patch: Record<string, unknown> = {}) => ({
  description: "The streetlight on Station Road has been broken for two weeks.",
  contact_phone: "",
  consent: true,
  draftId: randomUUID(),
  media: [],
  ...patch,
});

async function runAfter() {
  for (const fn of afterQueue.splice(0)) await fn();
}

test("no email: accepted exactly as before, office notified, no receipt", async () => {
  fresh();
  const res = await submitComplaint(form());
  assert.equal(res.success, true);
  assert.equal(res.success && res.receiptQueued, false);
  assert.equal("contact_email" in inserted[0], false, "row is unchanged when no email is given");
  await runAfter();
  assert.equal(sender.delivered.length, 1);
  assert.deepEqual(sender.delivered[0].email.to, ["dipak@example.org"]);
});

test("a form from before the email field existed still submits", async () => {
  fresh();
  const legacy = form();
  delete (legacy as Record<string, unknown>).contact_email;
  assert.equal((await submitComplaint(legacy)).success, true);
});

test("valid email: stored, receipt queued and sent with the reference number", async () => {
  fresh();
  const res = await submitComplaint(form({ contact_email: "  Citizen@Example.COM " }));
  assert.ok(res.success);
  if (!res.success) return;
  assert.equal(res.receiptQueued, true);
  assert.equal(inserted[0].contact_email, "Citizen@example.com");
  await runAfter();
  const receipt = sender.delivered.find((d) => d.email.to[0] === "citizen@example.com");
  assert.ok(receipt);
  assert.match(receipt.email.subject, new RegExp(`REF-${res.referenceId.slice(0, 8).toUpperCase()}`));
  assert.doesNotMatch(receipt.email.text, /streetlight/i, "the complaint text is never emailed");
});

test("invalid or overlong email is rejected before anything is saved", async () => {
  fresh();
  for (const bad of ["not-an-email", "a@b", `${"x".repeat(250)}@example.com`, "a@example.com\nBcc: b@example.com"]) {
    const res = await submitComplaint(form({ contact_email: bad }));
    assert.equal(res.success, false, bad);
    assert.ok(!res.success && res.fieldErrors?.contact_email, bad);
  }
  assert.equal(inserted.length, 0);
  assert.equal(store.messageList().length, 0);
});

test("email failures never undo or block a saved complaint", async () => {
  fresh();
  sender.respond(permanentError, permanentError);
  const res = await submitComplaint(form({ contact_email: "a@example.com" }));
  assert.equal(res.success, true);
  await runAfter();
  assert.equal(inserted.length, 1);
  assert.ok(store.messageList().every((m) => m.status === "failed"));

  fresh();
  store.failures.set("loadSettings", new Error("relation email_settings does not exist"));
  const noTables = await submitComplaint(form({ contact_email: "a@example.com" }));
  assert.equal(noTables.success, true);
  assert.equal(noTables.success && noTables.receiptQueued, false);
  assert.equal(inserted.length, 1);
});

test("if the live table lacks contact_email, the complaint is still saved (without the email)", async () => {
  fresh();
  insertErrors.push({ code: "PGRST204", message: "Could not find the 'contact_email' column of 'complaints' in the schema cache" });
  const res = await submitComplaint(form({ contact_email: "a@example.com" }));
  assert.equal(res.success, true);
  assert.equal(res.success && res.receiptQueued, false);
  assert.equal(inserted.length, 1);
  assert.equal("contact_email" in inserted[0], false);
});

test("the rate limit follows CF-Connecting-IP; a forged X-Forwarded-For can't get round it", async () => {
  fresh();
  const ip = `10.9.0.${ipCounter}`;
  let n = 0;
  // What Render passes on for a visitor who forges X-Forwarded-For (probed
  // 2026-10-18): their value first, then the real chain.
  requestHeaders = () => ({ "cf-connecting-ip": ip, "x-forwarded-for": `203.0.113.${++n},${ip}, 172.71.202.162, 10.26.96.152` });
  try {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await submitComplaint(form()));
    assert.equal(results.filter((r) => r.success).length, 5);
    const last = results[5];
    assert.ok(!last.success && /Too many complaints/.test(last.error));
    assert.equal(inserted.length, 5);
  } finally {
    requestHeaders = null;
  }
});

test("existing rules are unchanged: consent still required", async () => {
  fresh();
  const res = await submitComplaint(form({ consent: false, contact_email: "a@example.com" }));
  assert.equal(res.success, false);
  assert.equal(inserted.length, 0);
});

// Feature D: webhook authentication, received-mail validation and
// de-duplication, body download, delivery events, and safe HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { MemoryStore } = await import("@/tests/unit/helpers/memory-store");
const { computeWebhookSignature, verifyWebhookSignature } = await import("@/lib/email/webhook-signature");
const { applyDeliveryEvent, fetchInboundBody, ingestReceived, parseReceivedEvent, MAX_ATTACHMENTS, MAX_TEXT_BODY } = await import(
  "@/lib/email/inbound"
);
const { sanitizeEmailHtml, htmlToText } = await import("@/lib/email/sanitize");

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const NOW = Date.parse("2026-10-17T07:00:00Z");
const TS = String(Math.floor(NOW / 1000));

function signed(body: string, opts: { id?: string; ts?: string; secret?: string } = {}) {
  const id = opts.id ?? "msg_2abc";
  const ts = opts.ts ?? TS;
  return { id, timestamp: ts, signature: `v1,${computeWebhookSignature(opts.secret ?? SECRET, id, ts, body)}` };
}

test("webhook signature: valid passes; tampering, wrong secret, stale time or missing headers fail", () => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
  assert.equal(verifyWebhookSignature(body, signed(body), SECRET, NOW), true);
  assert.equal(verifyWebhookSignature(body + " ", signed(body), SECRET, NOW), false);
  assert.equal(verifyWebhookSignature(body, signed(body, { secret: `whsec_${randomBytes(24).toString("base64")}` }), SECRET, NOW), false);
  assert.equal(verifyWebhookSignature(body, signed(body, { ts: String(Number(TS) - 301) }), SECRET, NOW), false);
  assert.equal(verifyWebhookSignature(body, signed(body, { ts: String(Number(TS) + 301) }), SECRET, NOW), false);
  assert.equal(verifyWebhookSignature(body, { ...signed(body), signature: null }, SECRET, NOW), false);
  assert.equal(verifyWebhookSignature(body, { ...signed(body), id: "other" }, SECRET, NOW), false);
  const good = signed(body);
  // Several signatures (secret rotation): any v1 match passes; other versions never do.
  assert.equal(verifyWebhookSignature(body, { ...good, signature: `v1,bogus ${good.signature}` }, SECRET, NOW), true);
  assert.equal(verifyWebhookSignature(body, { ...good, signature: good.signature.replace("v1,", "v2,") }, SECRET, NOW), false);
});

const receivedData = (patch: Record<string, unknown> = {}) => ({
  email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
  created_at: "2026-10-17T06:59:00.000Z",
  from: "Ram Kumar <ram@example.com>",
  to: ["office@janatardipak.com"],
  cc: [],
  bcc: [],
  received_for: [],
  message_id: "<abc-123@mail.example.com>",
  subject: "Road repair",
  attachments: [{ id: "a1", filename: "../../etc/passwd", content_type: "text/plain", content_disposition: "attachment" }],
  ...patch,
});

test("received event: validates and cleans fields", () => {
  const parsed = parseReceivedEvent(receivedData());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.from, { name: "Ram Kumar", address: "ram@example.com" });
  assert.equal(parsed.value.attachments[0].filename, "passwd");
  assert.equal(parsed.value.messageId, "<abc-123@mail.example.com>");

  assert.equal(parseReceivedEvent(receivedData({ email_id: "../x" })).ok, false);
  assert.equal(parseReceivedEvent(receivedData({ from: "not an address" })).ok, false);
  assert.equal(parseReceivedEvent(receivedData({ to: ["bad"] })).ok, false);
  const injected = parseReceivedEvent(receivedData({ message_id: "<a@b>\r\nBcc: x@evil.com", subject: "Hi\r\nBcc: x" }));
  assert.equal(injected.ok && injected.value.messageId, null);
  assert.equal(injected.ok && injected.value.subject, "Hi Bcc: x");
  const many = parseReceivedEvent(receivedData({ attachments: Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, filename: "f" })) }));
  assert.equal(many.ok && many.value.attachments.length, MAX_ATTACHMENTS);
});

test("received mail is stored once per Resend id, and only for the verified domain", async () => {
  const store = new MemoryStore();
  const parsed = parseReceivedEvent(receivedData());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const first = await ingestReceived(store, parsed.value, "janatardipak.com");
  const again = await ingestReceived(store, parsed.value, "janatardipak.com");
  assert.equal(first.status, "stored");
  assert.equal(again.status, "duplicate");
  assert.equal(store.inbound.size, 1);

  const other = parseReceivedEvent(receivedData({ email_id: "other-1", to: ["someone@another-site.com"] }));
  assert.ok(other.ok);
  if (other.ok) assert.equal((await ingestReceived(store, other.value, "janatardipak.com")).status, "ignored");
  const sub = parseReceivedEvent(receivedData({ email_id: "sub-1", to: ["help@inbox.janatardipak.com"] }));
  if (sub.ok) assert.equal((await ingestReceived(store, sub.value, "janatardipak.com")).status, "stored");
  assert.equal((await ingestReceived(store, parsed.value, null)).status, "ignored");
});

test("body download: stores bounded text/html and auth results; restricted key fails; 5xx retries", async () => {
  const store = new MemoryStore();
  const parsed = parseReceivedEvent(receivedData());
  if (!parsed.ok) throw new Error("parse");
  const stored = await ingestReceived(store, parsed.value, "janatardipak.com");
  if (stored.status === "ignored") throw new Error("ignored");
  const id = stored.id;

  let calls = 0;
  const ok = await fetchInboundBody(store, async () => {
    calls += 1;
    return {
      ok: true,
      email: {
        id: "x",
        from: "ram@example.com",
        fromHeader: "Ram Kumar <ram@example.com>",
        to: ["office@janatardipak.com"],
        cc: [],
        replyTo: ["Ram <reply@example.com>", "bad"],
        subject: "Road repair",
        html: "<p>Hello</p>",
        text: "x".repeat(MAX_TEXT_BODY + 10),
        messageId: "<abc-123@mail.example.com>",
        createdAt: null,
        authentication: { spf: "pass", dkim: "pass", dmarc: "fail" },
        attachments: [{ id: "a1", filename: "x", contentType: "text/plain", size: 42, contentDisposition: null, contentId: null }],
      },
    };
  }, id);
  assert.equal(ok, "fetched");
  const row = store.inbound.get(id)!;
  assert.equal(row.text_body?.length, MAX_TEXT_BODY);
  assert.equal(row.body_truncated, true);
  assert.equal(row.auth_dmarc, "fail");
  assert.deepEqual(row.reply_to_addresses, ["reply@example.com"]);
  assert.equal((row.attachments as { size: number }[])[0].size, 42);
  // Already fetched: not fetched again.
  assert.equal(await fetchInboundBody(store, async () => { throw new Error("should not run"); }, id), "skipped");
  assert.equal(calls, 1);

  const second = await ingestReceived(store, { ...parsed.value, providerEmailId: "second" }, "janatardipak.com");
  if (second.status === "ignored") throw new Error("ignored");
  const restricted = await fetchInboundBody(
    store,
    async () => ({ ok: false, retryable: false, status: 401, code: "restricted_api_key", message: "Full access needed" }),
    second.id
  );
  assert.equal(restricted, "failed");
  assert.match(store.inbound.get(second.id)!.body_error ?? "", /restricted_api_key/);

  const third = await ingestReceived(store, { ...parsed.value, providerEmailId: "third" }, "janatardipak.com");
  if (third.status === "ignored") throw new Error("ignored");
  const flaky = async () => ({ ok: false as const, retryable: true, status: 503, code: "service_unavailable", message: "later" });
  assert.equal(await fetchInboundBody(store, flaky, third.id), "retry");
  assert.equal(store.inbound.get(third.id)!.body_status, "pending");
});

test("delivery events move status forward only, and ignore unknown ids", async () => {
  const store = new MemoryStore();
  const { id } = await store.insertMessage({ kind: "test", dedupeKey: "t1", toAddresses: ["a@example.com"] });
  await store.updateMessage(id, { status: "sent", provider_message_id: "re_1" });
  const data = { email_id: "re_1" };

  assert.equal(await applyDeliveryEvent(store, "email.delivered", data, "2026-10-17T07:00:00Z"), "updated");
  assert.equal(store.messages.get(id)!.status, "delivered");
  assert.equal(await applyDeliveryEvent(store, "email.delivered", data, "2026-10-17T07:00:00Z"), "ignored");
  assert.equal(await applyDeliveryEvent(store, "email.delivery_delayed", data, "2026-10-17T06:00:00Z"), "ignored");
  assert.equal(store.messages.get(id)!.status, "delivered");
  assert.equal(await applyDeliveryEvent(store, "email.complained", data, "2026-10-17T08:00:00Z"), "updated");
  assert.equal(store.messages.get(id)!.status, "complained");
  assert.equal(await applyDeliveryEvent(store, "email.delivered", { email_id: "re_unknown" }, null), "ignored");
  assert.equal(await applyDeliveryEvent(store, "email.opened", data, null), "ignored");
});

test("sanitizer removes scripts, handlers, forms, frames, CSS urls and remote images", () => {
  const dirty = `
    <script>alert(1)</script><style>body{background:url(https://t.example/p.gif)}</style>
    <p onclick="steal()" style="color:red;background-image:url(https://t.example/x)">Hello <b>there</b></p>
    <a href="javascript:alert(1)">bad</a> <a href="https://example.org/page" target="_self">good</a>
    <img src="https://tracker.example/pixel.gif"><img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">
    <img src="data:image/svg+xml;base64,PHN2Zz4=">
    <iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="pw"></form>
    <svg><script>alert(2)</script></svg><meta http-equiv="refresh" content="0;url=https://evil.example">`;
  const { html, blockedImages } = sanitizeEmailHtml(dirty);
  for (const forbidden of [/<script/i, /alert\(/, /onclick/i, /javascript:/i, /<iframe/i, /<form/i, /<input/i, /url\(/i, /tracker\.example/, /<svg/i, /<meta/i, /<style/i, /svg\+xml/]) {
    assert.doesNotMatch(html, forbidden);
  }
  assert.match(html, /color:red/);
  assert.match(html, /<a href="https:\/\/example\.org\/page" title="https:\/\/example\.org\/page" target="_blank" rel="noopener noreferrer nofollow">good<\/a>/);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.equal(blockedImages, 2);
});

test("htmlToText gives readable text without markup", () => {
  assert.equal(htmlToText("<p>Hello&nbsp;<b>Ram</b></p><p>Line&amp;two<br>three</p><script>x()</script>"), "Hello Ram\nLine&two\nthree");
});

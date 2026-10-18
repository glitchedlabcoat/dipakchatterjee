// lib/client-ip.ts, the visitor address the public rate limiters key on:
// only Cloudflare's CF-Connecting-IP is trusted (probed on Render on
// 2026-10-18), headers a visitor can set are ignored, and IPv6 is keyed
// by its /64.
import { test } from "node:test";
import assert from "node:assert/strict";

const { clientIpFrom, rateLimitKeyForIp } = await import("@/lib/client-ip");

test("uses CF-Connecting-IP and ignores the headers a visitor can forge", () => {
  const forged = new Headers({
    "cf-connecting-ip": "49.37.47.200",
    "x-forwarded-for": "203.0.113.7,49.37.47.200, 172.71.202.162, 10.26.96.152",
    "true-client-ip": "203.0.113.9",
    "x-real-ip": "203.0.113.10",
  });
  assert.equal(clientIpFrom(forged), "49.37.47.200");
});

test("without a valid CF-Connecting-IP requests share one key, never a client-chosen one", () => {
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7" })), "unknown");
  assert.equal(clientIpFrom(new Headers({ "cf-connecting-ip": "not-an-ip", "x-real-ip": "203.0.113.10" })), "unknown");
  assert.equal(clientIpFrom(new Headers({ "cf-connecting-ip": "203.0.113.7, 10.0.0.1" })), "unknown");
  assert.equal(clientIpFrom(new Headers()), "unknown");
});

test("IPv6 is keyed by its /64, so one connection can't rotate addresses", () => {
  const key = rateLimitKeyForIp("2401:4900:1c5a:8f2e:1:2:3:4");
  assert.equal(key, "2401:4900:1c5a:8f2e::/64");
  assert.equal(rateLimitKeyForIp("2401:4900:1c5a:8f2e:ffff:ffff:ffff:fffe"), key);
  assert.equal(rateLimitKeyForIp("2401:4900:1C5A:8F2E::9"), key, "case and :: don't matter");
  assert.notEqual(rateLimitKeyForIp("2401:4900:1c5a:8f2f::1"), key);

  assert.equal(rateLimitKeyForIp("2401:db8::1"), "2401:db8:0:0::/64");
  assert.equal(rateLimitKeyForIp("2401:0db8:0000:0000:0000:0000:0000:0001"), "2401:db8:0:0::/64");
  assert.equal(rateLimitKeyForIp("::1"), "0:0:0:0::/64");
  assert.equal(rateLimitKeyForIp("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(rateLimitKeyForIp("64:ff9b::49.37.47.200"), "64:ff9b:0:0::/64");
});

test("IPv4 is kept as is, including IPv4-mapped IPv6", () => {
  assert.equal(rateLimitKeyForIp("49.37.47.200"), "49.37.47.200");
  assert.equal(rateLimitKeyForIp(" 49.37.47.200 "), "49.37.47.200");
  assert.equal(rateLimitKeyForIp("::ffff:49.37.47.200"), "49.37.47.200");
  assert.equal(rateLimitKeyForIp("999.1.1.1"), null);
  assert.equal(rateLimitKeyForIp(""), null);
});

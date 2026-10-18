// lib/client-ip.ts
//
// The visitor's address, as the public rate limiters key it (complaint
// submission and the complaint upload-url route; see lib/rate-limit.ts).
//
// Render serves every request through Cloudflare, which sets
// CF-Connecting-IP to the address that actually connected. Probed on
// 2026-10-18 through both janatardipak.com and the .onrender.com URL:
//   * a CF-Connecting-IP sent by the visitor is refused at the edge
//     (Cloudflare error 1000), so the one that arrives is never forged;
//   * True-Client-IP is overwritten and X-Real-IP is stripped;
//   * X-Forwarded-For keeps whatever the visitor sent in front of the
//     real address ("<anything>, <visitor>, <cloudflare>, <render>"), so
//     its leftmost entry is never trusted here.
//
// IPv6 visitors are keyed by their /64: one connection usually holds a
// whole /64, and keying single addresses would let it rotate freely.
// Without the header (local `next start`, tests) every request shares
// the "unknown" key, which in production would mean one limit for the
// whole site, so that case is logged once.

import { isIP } from "node:net";

let warnedMissing = false;

function ipv6Groups(ip: string): string[] {
  const split = (s: string) => (s ? s.split(":") : []);
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const left = split(head);
  const right = tail === null ? [] : split(tail);
  // A trailing dotted IPv4 part ("::ffff:1.2.3.4") fills two groups.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const fill = tail === null ? 0 : 8 - width(left) - width(right);
  return [...left, ...Array<string>(fill).fill("0"), ...right];
}

/** Rate-limit key for an address: IPv4 as is, IPv6 as its /64 prefix. */
export function rateLimitKeyForIp(raw: string): string | null {
  const ip = raw.trim().split("%")[0];
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  const prefix = ipv6Groups(ip)
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

export function clientIpFrom(headers: Headers): string {
  const key = rateLimitKeyForIp(headers.get("cf-connecting-ip") ?? "");
  if (key) return key;

  if (process.env.NODE_ENV === "production" && !warnedMissing) {
    warnedMissing = true;
    console.warn("[client-ip] no valid CF-Connecting-IP header; rate limits fall back to one shared key");
  }
  return "unknown";
}

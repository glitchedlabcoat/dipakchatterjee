// lib/email/resend.ts
//
// Resend's REST API through plain fetch (no SDK, same as the OTP mailer
// in lib/notify/email.ts). Nothing here logs or returns a message body,
// an API key or a full provider response; errors come back as a short
// code plus a truncated message.
//
// Resend specifics this relies on (docs checked 2026-10-17):
//   * Every request needs a User-Agent header, or Resend answers 403.
//   * POST /emails honours an `Idempotency-Key` (1-256 chars) for 24
//     hours: a repeat with the same payload returns the original result
//     without sending again; a different payload under the same key is
//     a 409 `invalid_idempotent_request`.
//   * Retryable: 429 rate_limit_exceeded, 429 daily_quota_exceeded (after
//     midnight UTC), 409 concurrent_idempotent_requests / resource_locked,
//     500 application_error, 503 service_unavailable.
//   * A 2xx means "accepted", not "delivered". Delivery is reported later
//     through webhooks (see lib/email/inbound.ts).

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "janatardipak-web/1.0 (+https://janatardipak.com)";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 300;

export type OutgoingEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string> | null;
  tags?: { name: string; value: string }[];
};

export type SendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      retryable: boolean;
      /** True when the request may have reached Resend (timeout, network drop, 5xx). */
      outcomeUnknown: boolean;
      status: number | null;
      code: string;
      message: string;
      retryAfterMs?: number;
    };

export type FetchLike = typeof fetch;

function truncate(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_ERROR_LENGTH ? `${oneLine.slice(0, MAX_ERROR_LENGTH)}…` : oneLine;
}

function msUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5) - now;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 24 * 3600) * 1000;
  return undefined;
}

export function classifyError(
  status: number,
  code: string,
  message: string,
  retryAfterHeader: string | null,
  now: number = Date.now()
): Extract<SendResult, { ok: false }> {
  const base = { ok: false as const, status, code, message: truncate(message) };

  if (status === 429) {
    if (code === "daily_quota_exceeded") {
      return { ...base, retryable: true, outcomeUnknown: false, retryAfterMs: msUntilNextUtcMidnight(now) };
    }
    if (code === "monthly_quota_exceeded") return { ...base, retryable: false, outcomeUnknown: false };
    return { ...base, retryable: true, outcomeUnknown: false, retryAfterMs: parseRetryAfter(retryAfterHeader) };
  }
  if (status === 409) {
    const retryable = code === "concurrent_idempotent_requests" || code === "resource_locked";
    return { ...base, retryable, outcomeUnknown: retryable };
  }
  if (status >= 500) return { ...base, retryable: true, outcomeUnknown: true };
  return { ...base, retryable: false, outcomeUnknown: false };
}

async function readError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    return {
      code: typeof body.name === "string" ? body.name.slice(0, 64) : `http_${res.status}`,
      message: typeof body.message === "string" ? body.message : res.statusText,
    };
  } catch {
    return { code: `http_${res.status}`, message: res.statusText || "Request failed" };
  }
}

export async function sendEmail(
  apiKey: string,
  email: OutgoingEmail,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch
): Promise<SendResult> {
  const body: Record<string, unknown> = {
    from: email.from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (email.replyTo) body.reply_to = email.replyTo;
  if (email.headers && Object.keys(email.headers).length > 0) body.headers = email.headers;
  if (email.tags?.length) body.tags = email.tags;

  let res: Response;
  try {
    res = await fetchImpl(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      retryable: true,
      outcomeUnknown: true,
      status: null,
      code: timedOut ? "timeout" : "network_error",
      message: timedOut ? "Resend did not answer within 10 seconds." : "Could not reach Resend.",
    };
  }

  if (!res.ok) {
    const { code, message } = await readError(res);
    return classifyError(res.status, code, message, res.headers.get("retry-after"));
  }

  try {
    const data = (await res.json()) as { id?: unknown };
    if (typeof data.id === "string" && data.id) return { ok: true, id: data.id.slice(0, 128) };
  } catch {
    // fall through
  }
  return {
    ok: false,
    retryable: true,
    outcomeUnknown: true,
    status: res.status,
    code: "bad_response",
    message: "Resend accepted the request but returned no email id.",
  };
}

export type ReceivedEmail = {
  id: string;
  from: string | null;
  fromHeader: string | null;
  to: string[];
  cc: string[];
  replyTo: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  messageId: string | null;
  createdAt: string | null;
  authentication: { spf: string | null; dkim: string | null; dmarc: string | null };
  attachments: { id: string; filename: string | null; contentType: string | null; size: number | null; contentDisposition: string | null; contentId: string | null }[];
};

export type ReceivedResult =
  | { ok: true; email: ReceivedEmail }
  | { ok: false; retryable: boolean; status: number | null; code: string; message: string };

const PROVIDER_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function stringArray(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 320));
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

/** GET /emails/receiving/{id}: body, headers and attachment metadata of a received email. */
export async function getReceivedEmail(apiKey: string, id: string, fetchImpl: FetchLike = fetch): Promise<ReceivedResult> {
  if (!PROVIDER_ID_RE.test(id)) {
    return { ok: false, retryable: false, status: null, code: "invalid_id", message: "Invalid received email id." };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, retryable: true, status: null, code: "network_error", message: "Could not reach Resend." };
  }

  if (!res.ok) {
    const { code, message } = await readError(res);
    const retryable = res.status === 429 || res.status >= 500;
    const hint =
      res.status === 401 || res.status === 403
        ? " Reading received mail needs a Resend API key with Full access."
        : "";
    return { ok: false, retryable, status: res.status, code, message: truncate(message + hint) };
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, retryable: true, status: res.status, code: "bad_response", message: "Unreadable response." };
  }

  const headers = (data.headers && typeof data.headers === "object" ? data.headers : {}) as Record<string, unknown>;
  const auth = (data.authentication && typeof data.authentication === "object" ? data.authentication : {}) as Record<string, unknown>;
  const attachments = Array.isArray(data.attachments) ? data.attachments.slice(0, 50) : [];

  return {
    ok: true,
    email: {
      id,
      from: str(data.from, 320),
      fromHeader: str(headers.from, 400),
      to: stringArray(data.to),
      cc: stringArray(data.cc),
      replyTo: stringArray(data.reply_to, 5),
      subject: str(data.subject, 998),
      html: typeof data.html === "string" ? data.html : null,
      text: typeof data.text === "string" ? data.text : null,
      messageId: str(data.message_id, 998),
      createdAt: str(data.created_at, 64),
      authentication: { spf: str(auth.spf, 32), dkim: str(auth.dkim, 32), dmarc: str(auth.dmarc, 32) },
      attachments: attachments
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .map((a) => ({
          id: str(a.id, 100) ?? "",
          filename: str(a.filename, 255),
          contentType: str(a.content_type, 255),
          size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : null,
          contentDisposition: str(a.content_disposition, 32),
          contentId: str(a.content_id, 255),
        })),
    },
  };
}

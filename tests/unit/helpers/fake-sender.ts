// tests/unit/helpers/fake-sender.ts
//
// Stands in for Resend: records every call (payload + idempotency key) and
// answers from a scripted queue. Like Resend, it collapses a repeat of the
// same idempotency key with an identical payload into the first result,
// and rejects the same key with a different payload (409).

import type { OutgoingEmail, SendResult } from "@/lib/email/resend";

export type SentCall = { email: OutgoingEmail; key: string };

export class FakeSender {
  calls: SentCall[] = [];
  /** Accepted sends, after idempotency collapsing: what a recipient would get. */
  delivered: SentCall[] = [];
  private script: SendResult[] = [];
  private seen = new Map<string, { payload: string; result: SendResult }>();
  private counter = 0;
  /** Optional hook run before answering (e.g. to interleave a concurrent call). */
  beforeAnswer?: () => Promise<void>;

  /** Queue the next answers; when empty, every send succeeds. */
  respond(...results: SendResult[]) {
    this.script.push(...results);
    return this;
  }

  send = async (email: OutgoingEmail, key: string): Promise<SendResult> => {
    this.calls.push({ email, key });
    if (this.beforeAnswer) await this.beforeAnswer();
    const payload = JSON.stringify(email);
    const prior = this.seen.get(key);
    if (prior) {
      if (prior.payload !== payload) {
        return { ok: false, retryable: false, outcomeUnknown: false, status: 409, code: "invalid_idempotent_request", message: "payload changed" };
      }
      if (prior.result.ok) return prior.result;
    }
    const result = this.script.shift() ?? { ok: true as const, id: `re_${++this.counter}` };
    if (result.ok) this.delivered.push({ email, key });
    this.seen.set(key, { payload, result });
    return result;
  };
}

export const transientError: SendResult = {
  ok: false,
  retryable: true,
  outcomeUnknown: true,
  status: 500,
  code: "application_error",
  message: "Resend had a problem",
};

export const permanentError: SendResult = {
  ok: false,
  retryable: false,
  outcomeUnknown: false,
  status: 422,
  code: "validation_error",
  message: "Invalid `to` field",
};

// lib/otp-login.ts
//
// Orchestrates the mandatory login OTP challenge: generate, hash +
// store, send by email, and verify a submitted code. Always uses the
// service-role client (admin_otp_codes has no client-facing RLS
// policies at all — see the migration).
//
// The OTP always goes to the site's single ADMIN profile's email (not
// necessarily whichever account is logging in) — this is a small site
// where the admin is meant to be the one gatekeeping every login,
// including a standard USER account's. See
// app/admin/login/actions.ts for how this plugs into the two-step
// login flow (password, then this).
//
// SMS is temporarily disabled (SMS_OTP_ENABLED below) — the `phone`
// column and the dashboard's phone field stay put so it can be
// re-enabled later, but no OTP is ever dispatched over it right now.
//
// This used to be skippable whenever RESEND_API_KEY/RESEND_FROM_EMAIL
// weren't set, on the theory that a code nobody could ever receive
// shouldn't lock the admin out. In practice that made OTP silently
// optional — the exact "password alone gets you into the dashboard"
// bypass this file now closes. The only remaining fail-safe is the
// truly unrecoverable case: the admin profile has no email address on
// file at all, so there is nowhere to send a challenge to no matter how
// the provider is configured. Whenever the provider itself isn't
// configured but an email address exists, the code is logged to the
// server console instead of a real inbox — enough to complete the flow
// in local development without ever bypassing the step. Configure
// RESEND_API_KEY/RESEND_FROM_EMAIL to actually deliver it by email.
import { createServiceClient } from "@/utils/supabase/admin";
import { generateOtp, hashOtp, verifyOtpHash, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/notify/email";
import { sendOtpSms } from "@/lib/notify/sms";

// Flip back to true to re-enable the SMS leg once a provider + a
// verified admin phone number are both in place.
const SMS_OTP_ENABLED = false;

const RESEND_COOLDOWN_MS = 30 * 1000;

export type OtpRequestResult =
  | { status: "sent" }
  // Fail-safe for the one truly unrecoverable case: no admin email on
  // file anywhere to challenge against.
  | { status: "skipped" }
  | { status: "cooldown"; retryAfterSeconds: number };

export async function requestLoginOtp(userId: string): Promise<OtpRequestResult> {
  const supabase = createServiceClient();

  const { data: mostRecent } = await supabase
    .from("admin_otp_codes")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mostRecent) {
    const elapsed = Date.now() - new Date(mostRecent.created_at).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { status: "cooldown", retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000) };
    }
  }

  // The OTP is delivered to the site's ADMIN contact info regardless of
  // who's logging in.
  const { data: admin } = await supabase
    .from("profiles")
    .select("email, phone")
    .eq("is_admin", true)
    .single();

  if (!admin?.email) {
    console.warn("[otp] Admin profile has no email on file — nowhere to send a challenge. Skipping OTP.");
    return { status: "skipped" };
  }

  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await supabase.from("admin_otp_codes").delete().eq("user_id", userId);

  const { error } = await supabase.from("admin_otp_codes").insert({
    user_id: userId,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);

  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

  if (!emailConfigured) {
    // Dev-only fallback so the mandatory OTP step can still be
    // completed locally without a real provider wired up. Enforced, not
    // just documented: in production a missing provider fails closed
    // instead, since printing a live login code would put a working
    // second factor into the host's log stream (Render) for anyone with
    // log access.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Could not send the login code: email delivery is not configured on the server.");
    }
    console.warn(
      `[otp] RESEND_API_KEY/RESEND_FROM_EMAIL not set — dev fallback, your login code is: ${code} (expires in 5 minutes)`
    );
  } else {
    const emailResult = await sendOtpEmail(admin.email, code);
    if (emailResult.error) console.error("[otp] email send failed:", emailResult.error);
    if (!emailResult.sent) {
      throw new Error(
        "Could not send the login code by email. Check that RESEND_API_KEY/RESEND_FROM_EMAIL in .env.local are correct."
      );
    }
  }

  if (SMS_OTP_ENABLED && admin.phone) {
    const smsResult = await sendOtpSms(admin.phone, code);
    if (smsResult.error) console.error("[otp] sms send failed:", smsResult.error);
  }

  return { status: "sent" };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" | "not_found" };

export async function verifyLoginOtp(userId: string, code: string): Promise<OtpVerifyResult> {
  const supabase = createServiceClient();

  const { data: row } = await supabase
    .from("admin_otp_codes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (!verifyOtpHash(code, row.code_hash)) {
    await supabase
      .from("admin_otp_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return { ok: false, reason: "invalid" };
  }

  // Delete rather than mark consumed: once verified, the code must never
  // be checkable again under any circumstance (see the Server Action
  // that calls this — it's also gated behind the pending-2FA cookie, so
  // this is defense in depth, not the only thing preventing reuse).
  await supabase.from("admin_otp_codes").delete().eq("id", row.id);
  return { ok: true };
}

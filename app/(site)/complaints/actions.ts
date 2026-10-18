// app/(site)/complaints/actions.ts
//
// Attachments no longer arrive here as file bytes — ComplaintMediaPicker
// already streamed each one straight to Cloudflare R2 via a presigned
// PUT (see app/api/complaints/upload-url/route.ts) before the citizen
// even hits Submit. This action just validates the form fields, confirms
// every referenced R2 object genuinely exists (headComplaintObject —
// never downloads it, just checks), and creates the complaint +
// complaint_media rows pointing at those keys.
//
// Email (optional): once the complaint is saved, queueComplaintEmails()
// records the office notification and, if the citizen gave an address,
// their receipt; both are sent right after the response via after(), and
// retried by the scheduled dispatch if Resend fails. Nothing on the email
// side can fail or roll back the submission.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { createServiceClient } from "@/utils/supabase/admin";
import type { TablesInsert } from "@/types/database.types";
import { clientIpFrom } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { headComplaintObject, R2_COMPLAINT_KEY_PREFIX } from "@/lib/r2-complaints";
import { isValidEmail, MAX_EMAIL_LENGTH, normalizeEmail } from "@/lib/email/address";
import { queueComplaintEmails } from "@/lib/email/complaint-emails";
import { deliverMessages } from "@/lib/email/outbox";
import { createEmailRuntime } from "@/lib/email/runtime";

const MAX_MEDIA = 6; // MAX_IMAGES (5) + MAX_VIDEOS (1), see ComplaintMediaPicker

// Public, unauthenticated endpoint — a low, honest cap against spam
// (see lib/rate-limit.ts for the single-instance-only caveat).
const RATE_LIMIT_MAX_SUBMISSIONS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const complaintSchema = z.object({
  description: z.string().trim().min(20, "Please provide at least 20 characters").max(5000),
  contact_phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || v.length >= 6, "Enter a valid phone number, or leave it blank"),
  // Optional: only used to send the citizen a receipt with their
  // reference number (and so the office can reply). Defaults to "" so a
  // form rendered before this field existed still submits.
  contact_email: z
    .string()
    .trim()
    .max(MAX_EMAIL_LENGTH, "That email address is too long")
    .default("")
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "Enter a valid email address, or leave it blank"),
  // Re-checked here, not just trusted from the form: the privacy/age
  // confirmation is the lawful basis for storing anything at all, so a
  // request that bypasses the client-side checkbox must still fail.
  consent: z.literal(true, { error: "Please confirm the privacy notice to submit." }),
  // The form's per-visit draft id, the same one the upload-url route
  // put in every key it issued (`r2-media/<draftId>/...`). Binding the
  // media keys to it means a submitter can only attach files uploaded
  // from their own form — not someone else's object, which would then
  // also be deleted when this complaint is purged.
  draftId: z.uuid(),
  media: z
    .array(
      z.object({
        key: z.string().trim().min(1).startsWith(R2_COMPLAINT_KEY_PREFIX),
        kind: z.enum(["image", "video"]),
      })
    )
    .max(MAX_MEDIA)
    .default([]),
}).refine(
  (v) => v.media.every((m) => m.key.startsWith(`${R2_COMPLAINT_KEY_PREFIX}${v.draftId}/`)),
  { path: ["media"], message: "One of the attachments didn't come from this form. Please re-add it." }
);

export type SubmitComplaintInput = {
  description: string;
  contact_phone: string;
  contact_email?: string;
  consent: boolean;
  draftId: string;
  media: { key: string; kind: "image" | "video" }[];
};

export type SubmitComplaintResult =
  | { success: true; referenceId: string; receiptQueued: boolean }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

export async function submitComplaint(input: SubmitComplaintInput): Promise<SubmitComplaintResult> {
  const ip = clientIpFrom(await headers());
  if (!checkRateLimit(`complaint:${ip}`, RATE_LIMIT_MAX_SUBMISSIONS, RATE_LIMIT_WINDOW_MS)) {
    return {
      success: false,
      error: "Too many complaints submitted from this connection recently. Please try again later.",
    };
  }

  const parsed = complaintSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { success: false, error: "Please check the form and try again.", fieldErrors };
  }

  const supabase = createServiceClient();

  const { data: settings } = await supabase
    .from("site_settings")
    .select("complaint_expiration_days")
    .eq("id", "default")
    .single();

  const days = settings?.complaint_expiration_days ?? 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const contactEmail = parsed.data.contact_email ? normalizeEmail(parsed.data.contact_email) : null;
  const baseRow: TablesInsert<"complaints"> = {
    description: parsed.data.description,
    contact_phone: parsed.data.contact_phone || null,
    expires_at: expiresAt,
  };
  // contact_email is only sent when the citizen gave one, so a complaint
  // without an email inserts exactly the same row as before this feature.
  const row: TablesInsert<"complaints"> = contactEmail ? { ...baseRow, contact_email: contactEmail } : baseRow;

  let { data: complaint, error } = await supabase.from("complaints").insert(row).select("id").single();

  // The column is in the original complaints migration, but the repo's
  // generated types aren't proof of the live schema. If PostgREST reports
  // it missing (PGRST204), save the complaint without it rather than lose
  // it; the receipt then can't be sent.
  let emailStored = Boolean(contactEmail);
  if (error?.code === "PGRST204" && contactEmail) {
    console.error("[submitComplaint] complaints.contact_email is missing; saved without the email address");
    emailStored = false;
    ({ data: complaint, error } = await supabase.from("complaints").insert(baseRow).select("id").single());
  }

  if (error || !complaint) {
    return { success: false, error: "Something went wrong submitting your complaint. Please try again." };
  }

  // Confirm each referenced object actually landed in R2 (i.e. the
  // presigned PUT really succeeded) before recording it — never trust
  // the client's say-so alone. A HEAD request only reads metadata, so
  // this still never pulls the file's bytes through this server.
  for (const [i, m] of parsed.data.media.entries()) {
    const head = await headComplaintObject(m.key);
    if (!head) continue;

    await supabase.from("complaint_media").insert({
      complaint_id: complaint.id,
      kind: m.kind,
      storage_path: m.key,
      display_order: i,
    });
  }

  revalidatePath("/admin/complaints");

  // Queued before responding (so a crash can't lose them), sent after.
  let receiptQueued = false;
  try {
    const email = createEmailRuntime(supabase);
    const queued = await queueComplaintEmails(email.store, {
      complaintId: complaint.id,
      contactEmail: emailStored ? contactEmail : null,
    });
    receiptQueued = queued.receiptQueued && email.send !== null;
    if (queued.ids.length > 0) after(() => deliverMessages(email, queued.ids));
  } catch (err) {
    console.error("[submitComplaint] email queue failed:", err instanceof Error ? err.message : "unknown");
  }

  return { success: true, referenceId: complaint.id, receiptQueued };
}

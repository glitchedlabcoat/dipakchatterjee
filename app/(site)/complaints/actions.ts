// app/(site)/complaints/actions.ts
//
// Attachments no longer arrive here as file bytes — ComplaintMediaPicker
// already streamed each one straight to Cloudflare R2 via a presigned
// PUT (see app/api/complaints/upload-url/route.ts) before the citizen
// even hits Submit. This action just validates the form fields, confirms
// every referenced R2 object genuinely exists (headComplaintObject —
// never downloads it, just checks), and creates the complaint +
// complaint_media rows pointing at those keys.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServiceClient } from "@/utils/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { headComplaintObject, R2_COMPLAINT_KEY_PREFIX } from "@/lib/r2-complaints";

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
  media: z
    .array(
      z.object({
        key: z.string().trim().min(1).startsWith(R2_COMPLAINT_KEY_PREFIX),
        kind: z.enum(["image", "video"]),
      })
    )
    .max(MAX_MEDIA)
    .default([]),
});

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  const forwardedFor = hdrs.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return hdrs.get("x-real-ip") ?? "unknown";
}

export type SubmitComplaintInput = {
  description: string;
  contact_phone: string;
  media: { key: string; kind: "image" | "video" }[];
};

export type SubmitComplaintResult =
  | { success: true; referenceId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

export async function submitComplaint(input: SubmitComplaintInput): Promise<SubmitComplaintResult> {
  const ip = await getClientIp();
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

  const { data: complaint, error } = await supabase
    .from("complaints")
    .insert({
      description: parsed.data.description,
      contact_phone: parsed.data.contact_phone || null,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

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

  return { success: true, referenceId: complaint.id };
}

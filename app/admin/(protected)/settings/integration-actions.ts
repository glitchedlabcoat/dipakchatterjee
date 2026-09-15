// app/admin/(protected)/settings/integration-actions.ts
"use server";

import { requireAdmin } from "@/lib/admin-guard";
import { logDashboardActivity } from "@/lib/activity-log";

export type MetaCredentialsInput = {
  meta_app_id: string;
  meta_app_secret: string;
};

// Deliberately writes to integration_settings, NOT site_settings — see
// the migration (20260929000000_integration_settings.sql) for why an
// App Secret can't live in the same publicly-readable row as the rest
// of Settings. No revalidatePublicPages()/revalidateTag() call here
// either: nothing on the public site reads this table.
export async function updateMetaCredentials(input: MetaCredentialsInput) {
  const { supabase, user } = await requireAdmin();

  const { error } = await supabase
    .from("integration_settings")
    .update({
      meta_app_id: input.meta_app_id.trim() || null,
      meta_app_secret: input.meta_app_secret.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "UPDATE_SETTINGS",
    entityType: "settings",
    details: "Updated Meta oEmbed API credentials",
  });
}

export type MetaConnectionTestResult = {
  ok: boolean;
  message: string;
};

// Calls Meta's oembed_video endpoint with no `url` param on purpose:
// Graph API still authenticates the access_token first and only then
// validates the rest of the request, so an invalid App ID/Secret pair
// fails with a distinct "OAuthException" / code 190 before it ever gets
// to complain about the missing url — that's enough to tell "bad
// credentials" apart from "credentials fine, wrong/missing target" (or
// even a real 200) without needing a hardcoded sample video URL to
// point the test at.
export async function testMetaConnection(input: MetaCredentialsInput): Promise<MetaConnectionTestResult> {
  await requireAdmin();

  const appId = input.meta_app_id.trim();
  const appSecret = input.meta_app_secret.trim();

  if (!appId || !appSecret) {
    return { ok: false, message: "Enter both the App ID and App Secret before testing." };
  }

  const accessToken = `${appId}|${appSecret}`;
  const url = `https://graph.facebook.com/v19.0/oembed_video?access_token=${encodeURIComponent(accessToken)}`;

  let body: { error?: { code?: number; type?: string; message?: string } };
  try {
    const res = await fetch(url, { method: "GET" });
    body = await res.json();
  } catch {
    return { ok: false, message: "Could not reach Meta's API. Check your network connection and try again." };
  }

  if (body.error?.code === 190 || body.error?.type === "OAuthException") {
    return { ok: false, message: "Meta rejected these credentials — double-check the App ID and App Secret." };
  }

  return { ok: true, message: "Meta accepted these credentials." };
}

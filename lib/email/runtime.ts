// lib/email/runtime.ts
//
// Production wiring: the Supabase-backed store plus Resend calls bound to
// RESEND_API_KEY. Server-only (it creates the service-role client).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createServiceClient } from "@/utils/supabase/admin";
import { getResendApiKey } from "@/lib/email/config";
import { getReceivedEmail, sendEmail } from "@/lib/email/resend";
import { createSupabaseEmailStore } from "@/lib/email/store";
import type { DispatchDeps } from "@/lib/email/dispatch";

/** Pass an existing service-role client to reuse it. */
export function createEmailRuntime(serviceClient?: SupabaseClient<Database>): DispatchDeps {
  const apiKey = getResendApiKey();
  return {
    store: createSupabaseEmailStore(serviceClient ?? createServiceClient()),
    send: apiKey ? (email, idempotencyKey) => sendEmail(apiKey, email, idempotencyKey) : null,
    fetchReceived: apiKey ? (id) => getReceivedEmail(apiKey, id) : null,
  };
}

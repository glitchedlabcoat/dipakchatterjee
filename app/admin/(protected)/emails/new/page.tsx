// app/admin/(protected)/emails/new/page.tsx
//
// New Message: a plain-text email from the office sender to up to 10
// recipients, with Save draft. ?draft=<id> resumes a saved draft. Any
// dashboard administrator can use it; sendComposedEmail/saveDraft check
// that again on the server, cap sending per hour and per day across all
// administrators, and fix the sender, so it can't be used as a relay.

import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { getProviderStatus } from "@/lib/email/config";
import { draftRecipientsToInput } from "@/lib/email/mailbox";
import EmailsHeader from "../EmailsHeader";
import { MigrationNotice, Notice, isMissingTable } from "../shared";
import ComposeForm, { type ComposeInitial } from "./ComposeForm";

export const metadata: Metadata = {
  title: "New Message - Emails | Dipak Chatterjee",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewMessagePage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams;
  const provider = getProviderStatus();
  const supabase = await createClient();

  let initial: ComposeInitial | null = null;
  let draftProblem: string | null = null;
  let missing = false;

  if (draft) {
    if (!UUID_RE.test(draft)) {
      draftProblem = "That draft link isn't valid.";
    } else {
      const { data, error } = await supabase
        .from("email_messages")
        .select("id, kind, status, dedupe_key, to_addresses, subject, body_text, updated_at, trashed_at")
        .eq("id", draft)
        .maybeSingle();
      if (isMissingTable(error)) missing = true;
      else if (!data || data.kind !== "compose") draftProblem = "That draft no longer exists.";
      else if (data.trashed_at) draftProblem = "That draft is in Trashed. Restore it from Trashed to keep editing.";
      else if (data.status !== "draft") draftProblem = "That draft has already been sent. Find it in Outbox or Sent.";
      else {
        const requestId = data.dedupe_key.startsWith("compose:") ? data.dedupe_key.slice("compose:".length) : null;
        initial = {
          draftId: data.id,
          requestId: requestId && UUID_RE.test(requestId) ? requestId : null,
          to: draftRecipientsToInput(data.to_addresses),
          subject: data.subject ?? "",
          body: data.body_text ?? "",
          updatedAt: data.updated_at,
        };
      }
    }
  } else {
    // A plain GET, not a HEAD/count query: a HEAD response has no body, so
    // "table missing" (PGRST205) would never reach isMissingTable().
    const { error } = await supabase.from("email_messages").select("id").limit(1);
    missing = isMissingTable(error);
  }

  const canSend = provider.apiKeyConfigured && Boolean(provider.defaultSender);

  return (
    <div>
      <EmailsHeader
        active="new"
        title={initial ? "Edit draft" : "New Message"}
        description="Write a plain-text email from the office address. Save it as a draft or send it through Resend."
      />

      {missing && <MigrationNotice />}

      {!canSend && (
        <Notice tone="warn" title="Sending isn't configured">
          <p>
            Set <code className="text-xs">RESEND_API_KEY</code> and <code className="text-xs">RESEND_FROM_EMAIL</code> in the
            Render dashboard (Environment) to send email. You can still save drafts.
          </p>
        </Notice>
      )}

      {draftProblem && (
        <Notice tone="warn" title="Can't open that draft">
          <p>{draftProblem}</p>
        </Notice>
      )}

      <div className="bg-white border border-line rounded-xl p-6 md:p-8">
        <ComposeForm key={initial?.draftId ?? "new"} initial={initial} canSend={canSend && !missing} canSave={!missing} />
      </div>

      <p className="text-xs text-ink-400 mt-4">
        &ldquo;Accepted by Resend&rdquo; means Resend took the message; &ldquo;Delivered&rdquo; appears in Sent once the
        recipient&apos;s mail server confirms it (needs the Resend webhook). Sending is limited to 20 messages an hour and 50 a
        day across all administrators.
      </p>
    </div>
  );
}

// app/admin/(protected)/emails/EmailsHeader.tsx
//
// The Emails header with the six section tabs and their small counts
// (unread mail, drafts, messages waiting in the Outbox). Server-only: it
// reads through the signed-in user's client, so the email tables' RLS
// (is_admin()) applies. Counts are best effort; if a query fails (e.g.
// the migration isn't applied yet) the badge is simply left out.

import { createClient } from "@/utils/supabase/server";
import { MAILBOX_KINDS, OUTBOX_STATUSES } from "@/lib/email/mailbox";
import { EmailsHeaderView, type EmailsCounts, type EmailsTab } from "./shared";

async function loadCounts(): Promise<EmailsCounts> {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [unread, drafts, outbox] = await Promise.all([
    supabase.from("email_inbound").select("id", head).eq("is_read", false).is("trashed_at", null),
    supabase.from("email_messages").select("id", head).eq("kind", "compose").eq("status", "draft").is("trashed_at", null),
    supabase
      .from("email_messages")
      .select("id", head)
      .in("kind", [...MAILBOX_KINDS])
      .in("status", [...OUTBOX_STATUSES])
      .is("sent_at", null)
      .is("trashed_at", null),
  ]);
  return {
    unread: unread.error ? undefined : (unread.count ?? undefined),
    drafts: drafts.error ? undefined : (drafts.count ?? undefined),
    outbox: outbox.error ? undefined : (outbox.count ?? undefined),
  };
}

export default async function EmailsHeader(props: { active: EmailsTab; title: string; description: string }) {
  const counts = await loadCounts().catch(() => ({}));
  return <EmailsHeaderView {...props} counts={counts} />;
}

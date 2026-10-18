// app/admin/(protected)/emails/sent/page.tsx
//
// Sent: an administrator's messages that Resend accepted (sent_at is set).
// The badge shows what happened next, from Resend's webhook events:
// "Accepted by Resend" until a delivery report arrives, then Delivered,
// Delayed, Bounced, Marked as spam, Suppressed or Failed. Moving one to
// Trashed only hides it here; an email can't be recalled from a recipient.

import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { getProviderStatus } from "@/lib/email/config";
import { MAILBOX_KINDS } from "@/lib/email/mailbox";
import EmailsHeader from "../EmailsHeader";
import { MESSAGE_LIST_COLUMNS, MessageRow, type MessageListRow } from "../MessageList";
import { EmptyState, MigrationNotice, Notice, PAGE_SIZE, Pager, isMissingTable, parsePage } from "../shared";

export const metadata: Metadata = {
  title: "Sent - Emails | Dipak Chatterjee",
};

export default async function SentPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const provider = getProviderStatus();
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("email_messages")
    .select(MESSAGE_LIST_COLUMNS, { count: "exact" })
    .in("kind", [...MAILBOX_KINDS])
    .not("sent_at", "is", null)
    .is("trashed_at", null)
    .order("sent_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as MessageListRow[];

  return (
    <div>
      <EmailsHeader active="sent" title="Sent" description="Messages Resend accepted, with their latest delivery status." />
      {isMissingTable(error) && <MigrationNotice />}
      {!provider.webhookConfigured && !isMissingTable(error) && (
        <Notice title="Delivery reports aren't connected">
          <p>
            Messages here were accepted by Resend. Whether each one was delivered, bounced or marked as spam only shows once the
            Resend webhook is set up (<code className="text-xs">RESEND_WEBHOOK_SECRET</code>). Until then they stay &ldquo;Accepted
            by Resend&rdquo;.
          </p>
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState>{isMissingTable(error) ? "Nothing sent yet." : "Nothing sent from the Emails section yet."}</EmptyState>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line overflow-hidden">
          {rows.map((row) => (
            <MessageRow key={row.id} row={row} section="sent" />
          ))}
        </ul>
      )}
      <Pager base="/admin/emails/sent" page={page} total={count ?? 0} label="Sent" />
      <p className="text-xs text-ink-400 mt-6">
        Citizen receipts, new-complaint notifications and reminders are listed under Settings, not here. Sent messages are kept
        for 365 days.
      </p>
    </div>
  );
}

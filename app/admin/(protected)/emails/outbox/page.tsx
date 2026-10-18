// app/admin/(protected)/emails/outbox/page.tsx
//
// Outbox: an administrator's messages (new messages, replies, test
// emails) that Resend hasn't accepted yet. Queued and sending rows are
// being worked on; failed and "not sent" rows wait for Retry. Every row
// here exists in the database before any send is attempted, and retries
// reuse the same Resend Idempotency-Key, so nothing is sent twice.

import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { getProviderStatus } from "@/lib/email/config";
import { MAILBOX_KINDS, OUTBOX_STATUSES } from "@/lib/email/mailbox";
import EmailsHeader from "../EmailsHeader";
import { MESSAGE_LIST_COLUMNS, MessageRow, type MessageListRow } from "../MessageList";
import { EmptyState, MigrationNotice, Notice, PAGE_SIZE, Pager, isMissingTable, parsePage } from "../shared";

export const metadata: Metadata = {
  title: "Outbox - Emails | Dipak Chatterjee",
};

export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const provider = getProviderStatus();
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("email_messages")
    .select(MESSAGE_LIST_COLUMNS, { count: "exact" })
    .in("kind", [...MAILBOX_KINDS])
    .in("status", [...OUTBOX_STATUSES])
    .is("sent_at", null)
    .is("trashed_at", null)
    .order("queued_at", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as MessageListRow[];

  return (
    <div>
      <EmailsHeader
        active="outbox"
        title="Outbox"
        description="Messages waiting to be accepted by Resend: queued, being sent, or failed."
      />
      {isMissingTable(error) && <MigrationNotice />}
      {!provider.cronConfigured && !isMissingTable(error) && (
        <Notice tone="warn" title="Automatic retries aren't running">
          <p>
            Messages are sent the moment you press Send. If Resend can&apos;t be reached, they wait here; they are only retried
            automatically once a scheduler calls <code className="text-xs">/api/cron/email</code> (see Settings). You can always
            press Retry.
          </p>
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState>{isMissingTable(error) ? "No outbox yet." : "Nothing waiting. Everything you sent was accepted by Resend."}</EmptyState>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line overflow-hidden">
          {rows.map((row) => (
            <MessageRow key={row.id} row={row} section="outbox" />
          ))}
        </ul>
      )}
      <Pager base="/admin/emails/outbox" page={page} total={count ?? 0} label="Outbox" />
      <p className="text-xs text-ink-400 mt-6">
        Retry sends the same message again with the same Resend idempotency key, so if Resend had in fact accepted it in the last
        24 hours, the recipient still gets it once. A failed message can be moved to Trashed; a queued or sending one can&apos;t.
      </p>
    </div>
  );
}

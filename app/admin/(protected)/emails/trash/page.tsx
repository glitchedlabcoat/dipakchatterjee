// app/admin/(protected)/emails/trash/page.tsx
//
// Trashed: received mail, drafts and sent messages an administrator moved
// here. It's a soft delete: every row is kept and can be restored to the
// section it came from. Nothing on this page deletes anything; the normal
// time-based retention still applies (drafts: never).

import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { MAILBOX_KINDS } from "@/lib/email/mailbox";
import EmailsHeader from "../EmailsHeader";
import {
  MESSAGE_LIST_COLUMNS,
  MessageRow,
  TrashedInboundItem,
  type MessageListRow,
  type TrashedInboundRow,
} from "../MessageList";
import { EmptyState, MigrationNotice, isMissingTable } from "../shared";

export const metadata: Metadata = {
  title: "Trashed - Emails | Dipak Chatterjee",
};

const LIMIT = 50;

type Item = { kind: "message"; row: MessageListRow } | { kind: "inbound"; row: TrashedInboundRow };

export default async function TrashPage() {
  const supabase = await createClient();
  const [messages, inbound] = await Promise.all([
    supabase
      .from("email_messages")
      .select(MESSAGE_LIST_COLUMNS, { count: "exact" })
      .in("kind", [...MAILBOX_KINDS])
      .not("trashed_at", "is", null)
      .order("trashed_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("email_inbound")
      .select("id, from_address, from_name, subject, received_at, trashed_at", { count: "exact" })
      .not("trashed_at", "is", null)
      .order("trashed_at", { ascending: false })
      .limit(LIMIT),
  ]);
  const missing = isMissingTable(messages.error) || isMissingTable(inbound.error);

  const items: Item[] = [
    ...((messages.data ?? []) as MessageListRow[]).map((row) => ({ kind: "message" as const, row })),
    ...((inbound.data ?? []) as TrashedInboundRow[]).map((row) => ({ kind: "inbound" as const, row })),
  ]
    .sort((a, b) => (b.row.trashed_at ?? "").localeCompare(a.row.trashed_at ?? ""))
    .slice(0, LIMIT);
  const total = (messages.count ?? 0) + (inbound.count ?? 0);

  return (
    <div>
      <EmailsHeader
        active="trash"
        title="Trashed"
        description="Messages moved out of the other sections. Nothing here is deleted; Restore puts a message back."
      />
      {missing && <MigrationNotice />}
      {items.length === 0 ? (
        <EmptyState>{missing ? "Nothing trashed yet." : "Trashed is empty."}</EmptyState>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line overflow-hidden">
          {items.map((item) =>
            item.kind === "message" ? (
              <MessageRow key={`m-${item.row.id}`} row={item.row} section="trash" />
            ) : (
              <TrashedInboundItem key={`i-${item.row.id}`} row={item.row} />
            )
          )}
        </ul>
      )}
      {total > items.length && (
        <p className="text-xs text-ink-400 mt-4">
          Showing the {items.length} most recently trashed of {total}. Restore some to see older ones.
        </p>
      )}
      <p className="text-xs text-ink-400 mt-6">
        Moving a message to Trashed doesn&apos;t recall it from anyone who received it. Received mail is kept for 365 days and sent
        messages for 365 days, trashed or not; drafts are kept until you send them.
      </p>
    </div>
  );
}

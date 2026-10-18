// app/admin/(protected)/emails/MessageList.tsx
//
// The list used by Drafts, Outbox, Sent and Trashed: one row per message
// with its status, subject, recipients, the time that matters for that
// section, any error, and the one action that section offers (Retry in
// the Outbox, Restore in Trashed). Server component; the buttons are
// small client components that call the server actions.

import Link from "next/link";
import { Inbox as InboxIcon, Reply } from "lucide-react";
import { draftRecipientsToInput } from "@/lib/email/mailbox";
import RetryButton from "./settings/RetryButton";
import TrashButton from "./TrashButton";
import { KIND_LABELS, StatusBadge, formatWhen } from "./shared";

export const MESSAGE_LIST_COLUMNS =
  "id, kind, status, to_addresses, subject, created_at, updated_at, queued_at, sent_at, last_event_at, last_error, attempts, next_attempt_at, trashed_at, inbound_id";

export type MessageListRow = {
  id: string;
  kind: string;
  status: string;
  to_addresses: string[];
  subject: string | null;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  sent_at: string | null;
  last_event_at: string | null;
  last_error: string | null;
  attempts: number;
  next_attempt_at: string;
  trashed_at: string | null;
  inbound_id: string | null;
};

export type TrashedInboundRow = {
  id: string;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  trashed_at: string | null;
};

type Section = "drafts" | "outbox" | "sent" | "trash";

function when(row: MessageListRow, section: Section): { label: string; at: string | null } {
  switch (section) {
    case "drafts":
      return { label: "Edited", at: row.updated_at };
    case "outbox":
      return { label: row.status === "pending" && row.attempts > 0 ? "Next try" : "Queued", at: row.status === "pending" && row.attempts > 0 ? row.next_attempt_at : row.queued_at };
    case "sent":
      return { label: "Sent", at: row.sent_at };
    default:
      return { label: "Trashed", at: row.trashed_at };
  }
}

export function messageHref(row: Pick<MessageListRow, "id" | "status" | "trashed_at">): string {
  return row.status === "draft" && !row.trashed_at ? `/admin/emails/new?draft=${row.id}` : `/admin/emails/message/${row.id}`;
}

export function MessageRow({ row, section }: { row: MessageListRow; section: Section }) {
  const time = when(row, section);
  const to = row.status === "draft" ? draftRecipientsToInput(row.to_addresses) : row.to_addresses.join(", ");
  const canRetry = section === "outbox" && (row.status === "failed" || row.status === "skipped");
  return (
    <li className="px-4 md:px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <StatusBadge status={row.status} />
        {row.kind !== "compose" && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-400">
            {row.kind === "reply" && <Reply className="w-3 h-3" aria-hidden="true" />}
            {KIND_LABELS[row.kind] ?? row.kind}
          </span>
        )}
        <Link href={messageHref(row)} className="min-w-0 flex-1 text-sm font-medium text-navy-900 hover:underline break-words">
          {row.subject?.trim() || "(no subject)"}
        </Link>
        <span className="text-xs text-ink-400 shrink-0">
          {time.label} {formatWhen(time.at)}
        </span>
      </div>
      <p className="text-xs text-ink-400 mt-1 break-all">{to ? `To ${to}` : "No recipients yet"}</p>
      {row.last_error && section !== "sent" && <p className="text-xs text-rust mt-1 break-words">{row.last_error}</p>}
      {section === "outbox" && row.attempts > 0 && <p className="text-xs text-ink-400 mt-1">Attempts: {row.attempts}</p>}
      {(canRetry || section === "trash") && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canRetry && <RetryButton id={row.id} />}
          {section === "trash" && <TrashButton id={row.id} type="message" trashed compact />}
        </div>
      )}
    </li>
  );
}

export function TrashedInboundItem({ row }: { row: TrashedInboundRow }) {
  return (
    <li className="px-4 md:px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border border-line text-ink-600 bg-paper-100">
          <InboxIcon className="w-3 h-3" aria-hidden="true" />
          Received
        </span>
        <Link href={`/admin/emails/${row.id}`} className="min-w-0 flex-1 text-sm font-medium text-navy-900 hover:underline break-words">
          {row.subject?.trim() || "(no subject)"}
        </Link>
        <span className="text-xs text-ink-400 shrink-0">Trashed {formatWhen(row.trashed_at)}</span>
      </div>
      <p className="text-xs text-ink-400 mt-1 break-all">
        From {row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address} · received {formatWhen(row.received_at)}
      </p>
      <div className="mt-2">
        <TrashButton id={row.id} type="inbound" trashed compact />
      </div>
    </li>
  );
}

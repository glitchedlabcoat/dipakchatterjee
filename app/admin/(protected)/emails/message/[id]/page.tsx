// app/admin/(protected)/emails/message/[id]/page.tsx
//
// One message an administrator sent or tried to send (Outbox, Sent, or
// Trashed): recipients, subject, the delivery timeline and the text that
// was sent, shown as plain text (never as HTML). An untrashed draft opens
// in New Message instead. System emails (receipts, notifications,
// reminders) aren't shown here; they're in Settings > System email history.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { draftRecipientsToInput, folderOf, messageTrashBlockedReason } from "@/lib/email/mailbox";
import EmailsHeader from "../../EmailsHeader";
import RetryButton from "../../settings/RetryButton";
import TrashButton from "../../TrashButton";
import { KIND_LABELS, Notice, StatusBadge, formatWhen } from "../../shared";

export const metadata: Metadata = {
  title: "Message - Emails | Dipak Chatterjee",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECTION = {
  drafts: { tab: "drafts", href: "/admin/emails/drafts", label: "Drafts" },
  outbox: { tab: "outbox", href: "/admin/emails/outbox", label: "Outbox" },
  sent: { tab: "sent", href: "/admin/emails/sent", label: "Sent" },
  trash: { tab: "trash", href: "/admin/emails/trash", label: "Trashed" },
} as const;

export default async function OutboundMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("email_messages")
    .select(
      "id, kind, status, to_addresses, subject, body_text, created_at, updated_at, queued_at, sent_at, last_event_at, last_error, attempts, next_attempt_at, trashed_at, inbound_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();

  const folder = folderOf(row);
  if (folder === "system") notFound();
  if (folder === "drafts") redirect(`/admin/emails/new?draft=${row.id}`);
  const section = SECTION[folder];
  const trashed = folder === "trash";
  const canRetry = folder === "outbox" && (row.status === "failed" || row.status === "skipped");
  const canTrash = trashed || messageTrashBlockedReason(row) === null;
  const to = row.status === "draft" ? draftRecipientsToInput(row.to_addresses) : row.to_addresses.join(", ");

  return (
    <div>
      <EmailsHeader active={section.tab} title="Message" description={`${KIND_LABELS[row.kind] ?? "Message"} in ${section.label}.`} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link href={section.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900">
          <ArrowLeft className="w-4 h-4" />
          Back to {section.label}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {canRetry && <RetryButton id={row.id} />}
          {canTrash && <TrashButton id={row.id} type="message" trashed={trashed} afterHref={trashed ? undefined : section.href} />}
        </div>
      </div>

      {trashed && (
        <Notice title="In Trashed">
          <p>
            Moved to Trashed {formatWhen(row.trashed_at)}. It isn&apos;t deleted: Restore puts it back
            {row.status === "draft" ? " in Drafts" : row.sent_at ? " in Sent" : " in the Outbox"}.
            {row.sent_at ? " Trashing a sent email doesn't recall it from the recipient." : ""}
          </p>
        </Notice>
      )}

      <div className="bg-white border border-line rounded-xl p-5 md:p-6 space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row.status} />
            <span className="text-xs text-ink-400">{KIND_LABELS[row.kind] ?? row.kind}</span>
          </div>
          <h2 className="font-display text-xl text-navy-900 break-words mt-2">{row.subject?.trim() || "(no subject)"}</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-400">To</dt>
            <dd className="text-navy-900 break-all">{to || "—"}</dd>
            <dt className="text-ink-400">Queued</dt>
            <dd className="text-ink-600">{formatWhen(row.queued_at)}</dd>
            <dt className="text-ink-400">Accepted by Resend</dt>
            <dd className="text-ink-600">{formatWhen(row.sent_at)}</dd>
            {row.last_event_at && (
              <>
                <dt className="text-ink-400">Last delivery report</dt>
                <dd className="text-ink-600">{formatWhen(row.last_event_at)}</dd>
              </>
            )}
            {row.attempts > 0 && (
              <>
                <dt className="text-ink-400">Attempts</dt>
                <dd className="text-ink-600">{row.attempts}</dd>
              </>
            )}
            {folder === "outbox" && row.status === "pending" && row.attempts > 0 && (
              <>
                <dt className="text-ink-400">Next try</dt>
                <dd className="text-ink-600">{formatWhen(row.next_attempt_at)}</dd>
              </>
            )}
          </dl>
          {row.inbound_id && (
            <p className="text-xs mt-3">
              <Link href={`/admin/emails/${row.inbound_id}`} className="text-ink-600 hover:text-navy-900 underline">
                Open the message this replies to
              </Link>
            </p>
          )}
        </div>

        {row.last_error && (
          <p className="text-sm text-rust break-words" role="status">
            {row.last_error}
          </p>
        )}
        {folder === "outbox" && !canTrash && (
          <p className="text-xs text-ink-400">This message is being sent, so it can&apos;t be moved to Trashed yet.</p>
        )}

        <div>
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Message</p>
          <div className="rounded-lg border border-line bg-paper-100 px-4 py-3 text-sm text-ink whitespace-pre-wrap break-words">
            {row.body_text?.trim() ? row.body_text : "(empty)"}
          </div>
        </div>
      </div>
    </div>
  );
}

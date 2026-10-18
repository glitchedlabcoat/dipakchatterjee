// app/admin/(protected)/emails/[id]/page.tsx
//
// One received message. The plain-text view is the default and never
// interprets markup. The HTML view is sanitized on the server
// (lib/email/sanitize.ts) and shown in a sandboxed iframe with remote
// images removed. Authentication results (SPF/DKIM/DMARC, from Resend)
// are shown so a spoofed sender is visible; nothing in the message is
// ever acted on automatically.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Paperclip, ShieldCheck } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { emailPreviewDocument, htmlToText, sanitizeEmailHtml } from "@/lib/email/sanitize";
import { replyRecipient, type InboundAttachment } from "@/lib/email/inbound";
import EmailsHeader from "../EmailsHeader";
import TrashButton from "../TrashButton";
import { Notice, StatusBadge, formatWhen } from "../shared";
import MessageView from "./MessageView";
import ReplyForm from "./ReplyForm";

export const metadata: Metadata = {
  title: "Message - Emails | Dipak Chatterjee",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatBytes(size: number | null): string {
  if (size === null) return "size unknown";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AuthResults({ spf, dkim, dmarc }: { spf: string | null; dkim: string | null; dmarc: string | null }) {
  if (!spf && !dkim && !dmarc) return null;
  const passed = dmarc === "pass";
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-xs ${
        passed ? "border-forest/40 bg-forest-100 text-forest" : "border-rust/40 bg-rust/10 text-rust"
      }`}
    >
      {passed ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      <div>
        <p className="font-semibold">
          {passed ? "Sender verified (DMARC pass)" : "Sender could not be verified. The From address may be forged."}
        </p>
        <p className="mt-0.5 opacity-80">
          SPF {spf ?? "n/a"} · DKIM {dkim ?? "n/a"} · DMARC {dmarc ?? "n/a"}
        </p>
      </div>
    </div>
  );
}

export default async function InboundMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: message } = await supabase.from("email_inbound").select("*").eq("id", id).maybeSingle();
  if (!message) notFound();
  const trashed = Boolean(message.trashed_at);

  const { data: replies } = await supabase
    .from("email_messages")
    .select("id, status, created_at, last_error")
    .eq("inbound_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const sanitized = message.html_body ? sanitizeEmailHtml(message.html_body) : null;
  const text = message.text_body ?? (message.html_body ? htmlToText(message.html_body) : null);
  const attachments = Array.isArray(message.attachments) ? (message.attachments as unknown as InboundAttachment[]) : [];
  const replyTo = replyRecipient(message);

  return (
    <div>
      <EmailsHeader active={trashed ? "trash" : "inbox"} title="Message" description="A message received through Resend." />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link
          href={trashed ? "/admin/emails/trash" : "/admin/emails"}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900"
        >
          <ArrowLeft className="w-4 h-4" />
          {trashed ? "Back to Trashed" : "Back to Inbox"}
        </Link>
        <TrashButton id={message.id} type="inbound" trashed={trashed} afterHref={trashed ? undefined : "/admin/emails"} />
      </div>

      {trashed && (
        <Notice title="In Trashed">
          <p>
            Moved to Trashed {formatWhen(message.trashed_at)}. It isn&apos;t deleted: Restore puts it back in the Inbox.
          </p>
        </Notice>
      )}

      <div className="bg-white border border-line rounded-xl p-5 md:p-6 mb-6 space-y-4">
        <div>
          <h2 className="font-display text-xl text-navy-900 break-words">{message.subject?.trim() || "(no subject)"}</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-400">From</dt>
            <dd className="text-navy-900 break-all">
              {message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address}
            </dd>
            <dt className="text-ink-400">To</dt>
            <dd className="text-ink-600 break-all">{message.to_addresses.join(", ")}</dd>
            {message.cc_addresses.length > 0 && (
              <>
                <dt className="text-ink-400">Cc</dt>
                <dd className="text-ink-600 break-all">{message.cc_addresses.join(", ")}</dd>
              </>
            )}
            {message.reply_to_addresses.length > 0 && (
              <>
                <dt className="text-ink-400">Reply-To</dt>
                <dd className="text-ink-600 break-all">{message.reply_to_addresses.join(", ")}</dd>
              </>
            )}
            <dt className="text-ink-400">Received</dt>
            <dd className="text-ink-600">{formatWhen(message.received_at)}</dd>
          </dl>
        </div>

        <AuthResults spf={message.auth_spf} dkim={message.auth_dkim} dmarc={message.auth_dmarc} />

        {attachments.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Attachments</p>
            <ul className="space-y-1">
              {attachments.map((a, i) => (
                <li key={`${a.id}-${i}`} className="flex items-center gap-2 text-sm text-ink-600">
                  <Paperclip className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                  <span className="break-all">{a.filename}</span>
                  <span className="text-xs text-ink-400 shrink-0">
                    {a.contentType} · {formatBytes(a.size)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-400 mt-2">
              Attachments are not downloaded to this site. Open them from the Resend dashboard only if you trust the
              sender.
            </p>
          </div>
        )}

        <MessageView
          id={message.id}
          isRead={message.is_read}
          text={text}
          htmlDocument={sanitized ? emailPreviewDocument(sanitized.html) : null}
          blockedImages={sanitized?.blockedImages ?? 0}
          bodyStatus={message.body_status}
          bodyError={message.body_error}
          truncated={message.body_truncated}
        />
      </div>

      <div className="bg-white border border-line rounded-xl p-5 md:p-6">
        <p className="text-sm font-semibold text-navy-900 mb-1">Reply</p>
        {replies && replies.length > 0 && (
          <ul className="mb-4 space-y-1">
            {replies.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                <StatusBadge status={r.status} />
                <span>{formatWhen(r.created_at)}</span>
                {r.last_error && <span className="text-rust">{r.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
        {trashed ? (
          <p className="text-sm text-ink-400">Restore this message to reply to it.</p>
        ) : !replyTo ? (
          <p className="text-sm text-ink-400">This message has no valid address to reply to.</p>
        ) : (
          <ReplyForm inboundId={message.id} to={replyTo} />
        )}
      </div>
    </div>
  );
}

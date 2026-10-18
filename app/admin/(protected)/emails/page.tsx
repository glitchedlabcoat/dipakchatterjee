// app/admin/(protected)/emails/page.tsx
//
// Inbox: mail received at the verified domain through Resend (see
// lib/email/inbound.ts). Bounded: 25 per page, newest first, with a
// subject/sender search and an unread filter; trashed mail is in
// Trashed instead. Reads go through the signed-in user's client, so RLS
// (is_admin(): any dashboard profile) applies on top of the layout's own
// redirect.
//
// Honest about state: if receiving isn't connected, the page says so and
// shows no messages; it never invents any, and never shows sent mail.

import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Mail, MailOpen, Paperclip, Search } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getProviderStatus } from "@/lib/email/config";
import EmailsHeader from "./EmailsHeader";
import { MigrationNotice, Notice, PAGE_SIZE, formatWhen, isMissingTable, parsePage } from "./shared";

export const metadata: Metadata = {
  title: "Inbox - Emails | Dipak Chatterjee",
};

type InboxSearchParams = { q?: string; filter?: string; page?: string };

function cleanSearch(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}@._+\- ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function pageHref(params: { q: string; unread: boolean; page: number }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.unread) sp.set("filter", "unread");
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/emails?${qs}` : "/admin/emails";
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const raw = await searchParams;
  const q = cleanSearch(raw.q);
  const unread = raw.filter === "unread";
  const page = parsePage(raw.page);

  const provider = getProviderStatus();
  const supabase = await createClient();

  let query = supabase
    .from("email_inbound")
    .select("id, from_address, from_name, to_addresses, subject, received_at, is_read, attachments, auth_dmarc", {
      count: "exact",
    })
    .is("trashed_at", null)
    .order("received_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (unread) query = query.eq("is_read", false);
  if (q) query = query.or(`subject.ilike.*${q}*,from_address.ilike.*${q}*,from_name.ilike.*${q}*`);

  const { data, count, error } = await query;
  const messages = data ?? [];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const domain = provider.verifiedDomain ?? "your domain";

  return (
    <div>
      <EmailsHeader
        active="inbox"
        title="Inbox"
        description={`Messages sent to addresses at @${domain}, received through Resend.`}
      />

      {isMissingTable(error) && <MigrationNotice />}

      {!provider.webhookConfigured && !isMissingTable(error) && (
        <Notice tone="warn" title="Receiving isn't connected yet">
          <p>
            Mail sent to @{domain} does not reach this inbox until three things are set up: receiving is turned on for
            the domain in Resend and its MX record is added at the DNS provider; a Resend webhook points at{" "}
            <code className="text-xs">https://janatardipak.com/api/webhooks/resend</code>; and that webhook&apos;s signing
            secret is set on Render as <code className="text-xs">RESEND_WEBHOOK_SECRET</code>.
          </p>
          <p>Sending (receipts, notifications, reminders and New message) works without any of this.</p>
        </Notice>
      )}

      <form method="get" action="/admin/emails" className="flex flex-wrap items-end gap-2 mb-5" role="search">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="q" className="sr-only">
            Search sender or subject
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              id="q"
              name="q"
              defaultValue={q}
              maxLength={80}
              placeholder="Search sender or subject"
              className="w-full rounded-md border border-line bg-white pl-9 pr-3 py-2.5 text-sm text-ink focus:border-saffron focus:outline-none"
            />
          </div>
        </div>
        <label htmlFor="filter" className="sr-only">
          Show
        </label>
        <select
          id="filter"
          name="filter"
          defaultValue={unread ? "unread" : "all"}
          className="rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-saffron focus:outline-none"
        >
          <option value="all">All messages</option>
          <option value="unread">Unread only</option>
        </select>
        <button
          type="submit"
          className="bg-navy-900 hover:bg-navy-900/90 text-white text-sm font-semibold px-4 py-2.5 rounded-md"
        >
          Search
        </button>
        {(q || unread) && (
          <Link href="/admin/emails" className="text-sm text-ink-600 hover:text-navy-900 px-2 py-2.5">
            Clear
          </Link>
        )}
      </form>

      {messages.length === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-400">
          {isMissingTable(error)
            ? "No inbox yet."
            : q || unread
              ? "No messages match this search."
              : "No messages have been received yet."}
        </div>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line overflow-hidden">
          {messages.map((m) => {
            const attachmentCount = Array.isArray(m.attachments) ? m.attachments.length : 0;
            const authWarning = m.auth_dmarc !== null && m.auth_dmarc !== "pass";
            return (
              <li key={m.id}>
                <Link
                  href={`/admin/emails/${m.id}`}
                  className="flex items-start gap-3 px-4 md:px-5 py-4 hover:bg-paper-100 transition-colors"
                >
                  {m.is_read ? (
                    <MailOpen className="w-4 h-4 mt-0.5 text-ink-400 shrink-0" aria-label="Read" />
                  ) : (
                    <Mail className="w-4 h-4 mt-0.5 text-saffron-600 shrink-0" aria-label="Unread" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`text-sm truncate ${m.is_read ? "text-ink-600" : "font-semibold text-navy-900"}`}>
                        {m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address}
                      </p>
                      <p className="text-xs text-ink-400 shrink-0">{formatWhen(m.received_at)}</p>
                    </div>
                    <p className={`text-sm truncate mt-0.5 ${m.is_read ? "text-ink-600" : "text-navy-900"}`}>
                      {m.subject?.trim() || "(no subject)"}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-ink-400">
                      <span className="truncate">To {m.to_addresses.join(", ")}</span>
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="w-3 h-3" aria-hidden="true" />
                          {attachmentCount}
                        </span>
                      )}
                      {authWarning && (
                        <span className="inline-flex items-center gap-1 text-rust">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                          Sender not verified
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Inbox pages" className="flex items-center justify-between mt-4 text-sm">
          {page > 1 ? (
            <Link href={pageHref({ q, unread, page: page - 1 })} className="text-ink-600 hover:text-navy-900">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-400">
            Page {page} of {pages} · {total} message{total === 1 ? "" : "s"}
          </span>
          {page < pages ? (
            <Link href={pageHref({ q, unread, page: page + 1 })} className="text-ink-600 hover:text-navy-900">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <p className="text-xs text-ink-400 mt-6">
        Received messages are deleted automatically after 365 days. Attachments are listed by name and size only; open
        them from the Resend dashboard if needed.
      </p>
    </div>
  );
}

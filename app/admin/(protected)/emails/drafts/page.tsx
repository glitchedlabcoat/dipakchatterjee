// app/admin/(protected)/emails/drafts/page.tsx
//
// Drafts: composed messages saved but not sent. They live in the database
// (email_messages, status 'draft'), so they survive reloads, other
// browsers and redeploys, and every administrator sees the same ones.
// Opening one resumes it in New Message.

import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import EmailsHeader from "../EmailsHeader";
import { MESSAGE_LIST_COLUMNS, MessageRow, type MessageListRow } from "../MessageList";
import { EmptyState, MigrationNotice, PAGE_SIZE, Pager, isMissingTable, parsePage } from "../shared";

export const metadata: Metadata = {
  title: "Drafts - Emails | Dipak Chatterjee",
};

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("email_messages")
    .select(MESSAGE_LIST_COLUMNS, { count: "exact" })
    .eq("kind", "compose")
    .eq("status", "draft")
    .is("trashed_at", null)
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as MessageListRow[];

  return (
    <div>
      <EmailsHeader active="drafts" title="Drafts" description="Messages saved but not sent yet. Open one to keep writing or send it." />
      {isMissingTable(error) && <MigrationNotice />}
      {rows.length === 0 ? (
        <EmptyState>{isMissingTable(error) ? "No drafts yet." : "No drafts. Use New Message and press Save draft to keep one here."}</EmptyState>
      ) : (
        <ul className="bg-white border border-line rounded-xl divide-y divide-line overflow-hidden">
          {rows.map((row) => (
            <MessageRow key={row.id} row={row} section="drafts" />
          ))}
        </ul>
      )}
      <Pager base="/admin/emails/drafts" page={page} total={count ?? 0} label="Drafts" />
      <p className="text-xs text-ink-400 mt-6">Drafts are shared by all administrators and are never deleted automatically.</p>
    </div>
  );
}

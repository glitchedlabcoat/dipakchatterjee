// app/admin/(protected)/emails/shared.tsx
//
// Small presentational pieces shared by the Emails pages (no hooks, so
// both server and client components can use them).

import Link from "next/link";
import { Settings } from "lucide-react";
import { formatInZone } from "@/lib/email/schedule";

export const DISPLAY_TIME_ZONE = "Asia/Kolkata";
export const PAGE_SIZE = 25;

export function formatWhen(iso: string | null | undefined, timeZone = DISPLAY_TIME_ZONE): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatInZone(ms, timeZone) : "—";
}

// The six sections. Settings (sender, notifications, reminders, system
// email history) is a secondary link, not a section.
const TABS = [
  { id: "inbox", href: "/admin/emails", label: "Inbox", count: "unread" },
  { id: "drafts", href: "/admin/emails/drafts", label: "Drafts", count: "drafts" },
  { id: "outbox", href: "/admin/emails/outbox", label: "Outbox", count: "outbox" },
  { id: "sent", href: "/admin/emails/sent", label: "Sent", count: null },
  { id: "trash", href: "/admin/emails/trash", label: "Trashed", count: null },
  { id: "new", href: "/admin/emails/new", label: "New Message", count: null },
] as const;

export type EmailsTab = (typeof TABS)[number]["id"] | "settings";
export type EmailsCounts = { unread?: number; drafts?: number; outbox?: number };

export function EmailsHeaderView({
  active,
  title,
  description,
  counts = {},
}: {
  active: EmailsTab;
  title: string;
  description: string;
  counts?: EmailsCounts;
}) {
  return (
    <div className="mb-8">
      <p className="text-sm font-semibold text-saffron-600 mb-2">Emails</p>
      <h1 className="font-display text-3xl text-navy-900">{title}</h1>
      <p className="text-sm text-ink-600 mt-1.5">{description}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
        <nav aria-label="Emails sections" className="flex flex-wrap gap-1.5">
          {TABS.map((tab) => {
            const count = tab.count ? counts[tab.count] : undefined;
            const isActive = tab.id === active;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
                  isActive ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600 hover:border-navy-900/40"
                }`}
              >
                {tab.label}
                {count ? (
                  <span
                    className={`min-w-[1.25rem] text-center rounded-full px-1.5 text-[10px] leading-4 ${
                      isActive ? "bg-white/20 text-white" : "bg-saffron-100 text-saffron-600"
                    }`}
                  >
                    <span className="sr-only">(</span>
                    {count > 99 ? "99+" : count}
                    <span className="sr-only">)</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/admin/emails/settings"
          aria-current={active === "settings" ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
            active === "settings" ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600 hover:border-navy-900/40"
          }`}
        >
          <Settings className="w-3.5 h-3.5" aria-hidden="true" />
          Settings
        </Link>
      </div>
    </div>
  );
}

/** Previous/next links for a section list. `base` already includes the path. */
export function Pager({ base, page, total, label }: { base: string; page: number; total: number; label: string }) {
  if (total <= PAGE_SIZE) return null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => (p > 1 ? `${base}?page=${p}` : base);
  return (
    <nav aria-label={`${label} pages`} className="flex items-center justify-between mt-4 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-ink-600 hover:text-navy-900">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-400">
        Page {page} of {pages} · {total} message{total === 1 ? "" : "s"}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="text-ink-600 hover:text-navy-900">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function parsePage(value: string | undefined): number {
  return Math.min(Math.max(Number.parseInt(value ?? "1", 10) || 1, 1), 1000);
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-400">{children}</div>;
}

export const KIND_LABELS: Record<string, string> = {
  complaint_receipt: "Citizen receipt",
  office_notification: "New-complaint notification",
  reminder: "Reminder",
  compose: "Message",
  reply: "Reply",
  test: "Test email",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "border-line text-ink-600 bg-paper-100",
  pending: "border-saffron text-saffron-600 bg-saffron-100",
  sending: "border-saffron text-saffron-600 bg-saffron-100",
  sent: "border-navy-900/40 text-navy-900 bg-paper-100",
  delivered: "border-forest text-forest bg-forest-100",
  delivery_delayed: "border-saffron text-saffron-600 bg-saffron-100",
  bounced: "border-rust text-rust bg-rust/10",
  complained: "border-rust text-rust bg-rust/10",
  failed: "border-rust text-rust bg-rust/10",
  suppressed: "border-rust text-rust bg-rust/10",
  skipped: "border-line text-ink-400 bg-paper-100",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Queued",
  sending: "Sending",
  sent: "Accepted by Resend",
  delivered: "Delivered",
  delivery_delayed: "Delayed",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  suppressed: "Suppressed",
  skipped: "Not sent",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${STATUS_STYLES[status] ?? STATUS_STYLES.skipped}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn"; title: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-xl border p-5 mb-6 text-sm ${
        tone === "warn" ? "border-saffron bg-saffron-100/50 text-ink-600" : "border-line bg-white text-ink-600"
      }`}
    >
      <p className="font-semibold text-navy-900 mb-1">{title}</p>
      <div className="space-y-2 leading-relaxed">{children}</div>
    </div>
  );
}

/** PostgREST/Postgres "table doesn't exist" errors, i.e. the migration isn't applied yet. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "");
}

export function MigrationNotice() {
  return (
    <Notice tone="warn" title="Email tables not created yet">
      <p>
        The database changes for email haven&apos;t been applied. Run{" "}
        <code className="text-xs">supabase/migrations/20261017000000_email_system.sql</code> in the Supabase SQL editor
        (after review). Until then nothing is queued or sent, and complaint submission keeps working as before.
      </p>
    </Notice>
  );
}

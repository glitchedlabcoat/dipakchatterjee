// lib/email/store.ts
//
// The only place the email system touches the database. Everything else
// (outbox, reminders, inbound) talks to the EmailStore interface, so the
// unit tests run the real logic against an in-memory store
// (tests/unit/helpers/memory-store.ts) instead of a live database.
//
// The Supabase implementation uses the service-role client: it's called
// from the anonymous complaint form, the cron route and the webhook, none
// of which have an admin session. Admin server actions check
// requireAdmin() before calling it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import type { EmailInboundRow, EmailMessageRow } from "@/types/domain";
import { settingsFromRow, type EmailSettings } from "@/lib/email/settings";
import type { OfficeContact } from "@/lib/email/templates";

export const EMAIL_KINDS = ["complaint_receipt", "office_notification", "reminder", "compose", "reply", "test"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = [
  "draft",
  "pending",
  "sending",
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "failed",
  "suppressed",
  "skipped",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export type NewEmailMessage = {
  kind: EmailKind;
  dedupeKey: string;
  toAddresses: string[];
  complaintId?: string | null;
  inboundId?: string | null;
  fromHeader?: string | null;
  replyTo?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  extraHeaders?: Record<string, string> | null;
  createdBy?: string | null;
  /** 'draft' rows are never picked up by the outbox and get no queued_at. */
  status?: "pending" | "skipped" | "draft";
  lastError?: string | null;
};

/** Soft-delete state for Admin > Emails > Trashed; null restores. */
export type TrashState = { at: string; by: string | null } | null;

export type RetentionCutoffs = {
  /** Citizen receipts, notifications, reminders and test emails created before this are deleted. */
  systemBefore: string;
  /** Composed messages and replies (never drafts) created before this are deleted. */
  correspondenceBefore: string;
  /** Received mail received before this is deleted. */
  inboundBefore: string;
};

export type ComplaintSummary = {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: string;
  contactEmail: string | null;
  phoneProvided: boolean;
  attachmentCount: number;
};

export type InboundInsert = Database["public"]["Tables"]["email_inbound"]["Insert"];
export type InboundPatch = Database["public"]["Tables"]["email_inbound"]["Update"];
export type MessagePatch = Database["public"]["Tables"]["email_messages"]["Update"];

export interface EmailStore {
  loadSettings(): Promise<EmailSettings>;
  getOfficeContact(): Promise<OfficeContact>;

  /** Inserts unless dedupe_key already exists; returns the existing row's id in that case. */
  insertMessage(input: NewEmailMessage): Promise<{ id: string; inserted: boolean }>;
  getMessage(id: string): Promise<EmailMessageRow | null>;
  /**
   * Applies `patch` only if the row still has the `status` and `attempts`
   * read earlier and isn't trashed, so a trashed message is never sent.
   */
  claimMessage(row: EmailMessageRow, patch: MessagePatch): Promise<EmailMessageRow | null>;
  updateMessage(id: string, patch: MessagePatch): Promise<void>;
  /**
   * Edits (or sends, by patching status to 'pending') a draft, only while
   * it is still an untrashed compose draft and, when `expectedUpdatedAt`
   * is given, nobody saved it in between. Returns the new row, or null.
   */
  updateDraft(id: string, expectedUpdatedAt: string | null, patch: MessagePatch): Promise<EmailMessageRow | null>;
  /**
   * Moves an administrator's message (compose/reply/test) to Trashed, or
   * restores it with `null`. Trashing never applies to a row the outbox is
   * still working on (pending/sending). Returns the new row, or null.
   */
  setMessageTrash(id: string, trash: TrashState): Promise<EmailMessageRow | null>;
  listDueMessageIds(nowIso: string, staleClaimBeforeIso: string, limit: number): Promise<string[]>;
  /** Counts by queued_at (when a row entered the outbox), so drafts never count. */
  countMessagesSince(kinds: EmailKind[], sinceIso: string, toAddress?: string): Promise<number>;
  findMessageByProviderId(providerId: string): Promise<EmailMessageRow | null>;

  getComplaint(id: string): Promise<ComplaintSummary | null>;
  /** Not resolved and not expired, oldest first. */
  listUnresolvedComplaints(nowIso: string, limit: number): Promise<{ total: number; items: ComplaintSummary[] }>;

  insertInbound(row: InboundInsert): Promise<{ id: string; inserted: boolean }>;
  getInbound(id: string): Promise<EmailInboundRow | null>;
  updateInbound(id: string, patch: InboundPatch): Promise<void>;
  /** Moves received mail to Trashed, or restores it with `null`. Returns the new row, or null. */
  setInboundTrash(id: string, trash: TrashState): Promise<EmailInboundRow | null>;
  listInboundIdsNeedingBody(limit: number, maxAttempts: number): Promise<string[]>;

  markSchedulerRun(nowIso: string): Promise<void>;
  /** Time-based retention. Never deletes drafts or rows the outbox is still working on. */
  purgeOlderThan(cutoffs: RetentionCutoffs): Promise<{ messages: number; inbound: number }>;
}

const SYSTEM_RETENTION_KINDS: EmailKind[] = ["complaint_receipt", "office_notification", "reminder", "test"];
const CORRESPONDENCE_KINDS: EmailKind[] = ["compose", "reply"];
const MAILBOX_TRASH_KINDS: EmailKind[] = ["compose", "reply", "test"];

type ServiceClient = SupabaseClient<Database>;

type ComplaintRowWithMedia = {
  id: string;
  created_at: string;
  expires_at: string;
  status: string;
  contact_email: string | null;
  contact_phone: string | null;
  complaint_media: { id: string }[] | null;
};

function toSummary(row: ComplaintRowWithMedia): ComplaintSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    contactEmail: row.contact_email,
    phoneProvided: Boolean(row.contact_phone),
    attachmentCount: row.complaint_media?.length ?? 0,
  };
}

function fail(context: string, message: string): never {
  throw new Error(`[email-store] ${context}: ${message}`);
}

export function createSupabaseEmailStore(db: ServiceClient): EmailStore {
  return {
    async loadSettings() {
      const { data, error } = await db.from("email_settings").select("*").eq("id", "default").maybeSingle();
      if (error) fail("loadSettings", error.message);
      return settingsFromRow(data);
    },

    async getOfficeContact() {
      const { data } = await db.from("site_settings").select("office_email, office_address").eq("id", "default").maybeSingle();
      return { email: data?.office_email?.trim() || null, address: data?.office_address?.trim() || null };
    },

    async insertMessage(input) {
      const row: Database["public"]["Tables"]["email_messages"]["Insert"] = {
        kind: input.kind,
        dedupe_key: input.dedupeKey,
        to_addresses: input.toAddresses,
        complaint_id: input.complaintId ?? null,
        inbound_id: input.inboundId ?? null,
        from_header: input.fromHeader ?? null,
        reply_to: input.replyTo ?? null,
        subject: input.subject ?? null,
        body_text: input.bodyText ?? null,
        body_html: input.bodyHtml ?? null,
        extra_headers: (input.extraHeaders ?? null) as Json,
        created_by: input.createdBy ?? null,
        status: input.status ?? "pending",
        last_error: input.lastError ?? null,
      };
      // queued_at defaults to now() in the database; a draft isn't queued.
      if (input.status === "draft") row.queued_at = null;
      const { data, error } = await db
        .from("email_messages")
        .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (error) fail("insertMessage", error.message);
      if (data && data.length > 0) return { id: data[0].id, inserted: true };

      const existing = await db.from("email_messages").select("id").eq("dedupe_key", input.dedupeKey).maybeSingle();
      if (existing.error || !existing.data) fail("insertMessage", existing.error?.message ?? "duplicate row not found");
      return { id: existing.data.id, inserted: false };
    },

    async getMessage(id) {
      const { data, error } = await db.from("email_messages").select("*").eq("id", id).maybeSingle();
      if (error) fail("getMessage", error.message);
      return data;
    },

    async claimMessage(row, patch) {
      const { data, error } = await db
        .from("email_messages")
        .update(patch)
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("attempts", row.attempts)
        .is("trashed_at", null)
        .select("*")
        .maybeSingle();
      if (error) fail("claimMessage", error.message);
      return data;
    },

    async updateMessage(id, patch) {
      const { error } = await db.from("email_messages").update(patch).eq("id", id);
      if (error) fail("updateMessage", error.message);
    },

    async updateDraft(id, expectedUpdatedAt, patch) {
      let query = db
        .from("email_messages")
        .update(patch)
        .eq("id", id)
        .eq("kind", "compose")
        .eq("status", "draft")
        .is("trashed_at", null);
      if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) fail("updateDraft", error.message);
      return data;
    },

    async setMessageTrash(id, trash) {
      const now = new Date().toISOString();
      let query = db
        .from("email_messages")
        .update({ trashed_at: trash?.at ?? null, trashed_by: trash?.by ?? null, updated_at: now })
        .eq("id", id)
        .in("kind", MAILBOX_TRASH_KINDS);
      query = trash
        ? query.is("trashed_at", null).not("status", "in", "(pending,sending)")
        : query.not("trashed_at", "is", null);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) fail("setMessageTrash", error.message);
      return data;
    },

    async listDueMessageIds(nowIso, staleClaimBeforeIso, limit) {
      const { data, error } = await db
        .from("email_messages")
        .select("id")
        .or(`and(status.eq.pending,next_attempt_at.lte.${nowIso}),and(status.eq.sending,claimed_at.lt.${staleClaimBeforeIso})`)
        .order("next_attempt_at", { ascending: true })
        .limit(limit);
      if (error) fail("listDueMessageIds", error.message);
      return (data ?? []).map((r) => r.id);
    },

    async countMessagesSince(kinds, sinceIso, toAddress) {
      let query = db
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .in("kind", kinds)
        .gte("queued_at", sinceIso);
      if (toAddress) query = query.contains("to_addresses", [toAddress]);
      const { count, error } = await query;
      if (error) fail("countMessagesSince", error.message);
      return count ?? 0;
    },

    async findMessageByProviderId(providerId) {
      const { data, error } = await db.from("email_messages").select("*").eq("provider_message_id", providerId).maybeSingle();
      if (error) fail("findMessageByProviderId", error.message);
      return data;
    },

    async getComplaint(id) {
      const { data, error } = await db
        .from("complaints")
        .select("id, created_at, expires_at, status, contact_email, contact_phone, complaint_media(id)")
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getComplaint", error.message);
      return data ? toSummary(data as ComplaintRowWithMedia) : null;
    },

    async listUnresolvedComplaints(nowIso, limit) {
      // Same rules as the admin list: status 'resolved' is the only
      // resolved state, and anything at/after expires_at (or flagged
      // is_expired) is expired and about to be purged.
      const { data, count, error } = await db
        .from("complaints")
        .select("id, created_at, expires_at, status, contact_email, contact_phone, complaint_media(id)", { count: "exact" })
        .neq("status", "resolved")
        .eq("is_expired", false)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) fail("listUnresolvedComplaints", error.message);
      return { total: count ?? data?.length ?? 0, items: (data ?? []).map((r) => toSummary(r as ComplaintRowWithMedia)) };
    },

    async insertInbound(row) {
      const { data, error } = await db
        .from("email_inbound")
        .upsert(row, { onConflict: "provider_email_id", ignoreDuplicates: true })
        .select("id");
      if (error) fail("insertInbound", error.message);
      if (data && data.length > 0) return { id: data[0].id, inserted: true };

      const existing = await db.from("email_inbound").select("id").eq("provider_email_id", row.provider_email_id).maybeSingle();
      if (existing.error || !existing.data) fail("insertInbound", existing.error?.message ?? "duplicate row not found");
      return { id: existing.data.id, inserted: false };
    },

    async getInbound(id) {
      const { data, error } = await db.from("email_inbound").select("*").eq("id", id).maybeSingle();
      if (error) fail("getInbound", error.message);
      return data;
    },

    async updateInbound(id, patch) {
      const { error } = await db.from("email_inbound").update(patch).eq("id", id);
      if (error) fail("updateInbound", error.message);
    },

    async setInboundTrash(id, trash) {
      let query = db
        .from("email_inbound")
        .update({ trashed_at: trash?.at ?? null, trashed_by: trash?.by ?? null })
        .eq("id", id);
      query = trash ? query.is("trashed_at", null) : query.not("trashed_at", "is", null);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) fail("setInboundTrash", error.message);
      return data;
    },

    async listInboundIdsNeedingBody(limit, maxAttempts) {
      const { data, error } = await db
        .from("email_inbound")
        .select("id")
        .eq("body_status", "pending")
        .lt("body_fetch_attempts", maxAttempts)
        .order("received_at", { ascending: true })
        .limit(limit);
      if (error) fail("listInboundIdsNeedingBody", error.message);
      return (data ?? []).map((r) => r.id);
    },

    async markSchedulerRun(nowIso) {
      const { error } = await db.from("email_settings").update({ scheduler_last_run_at: nowIso }).eq("id", "default");
      if (error) fail("markSchedulerRun", error.message);
    },

    async purgeOlderThan(cutoffs) {
      const system = await db
        .from("email_messages")
        .delete({ count: "exact" })
        .in("kind", SYSTEM_RETENTION_KINDS)
        .lt("created_at", cutoffs.systemBefore)
        .not("status", "in", "(draft,pending,sending)");
      if (system.error) fail("purgeOlderThan", system.error.message);
      const correspondence = await db
        .from("email_messages")
        .delete({ count: "exact" })
        .in("kind", CORRESPONDENCE_KINDS)
        .lt("created_at", cutoffs.correspondenceBefore)
        .not("status", "in", "(draft,pending,sending)");
      if (correspondence.error) fail("purgeOlderThan", correspondence.error.message);
      const inbound = await db.from("email_inbound").delete({ count: "exact" }).lt("received_at", cutoffs.inboundBefore);
      if (inbound.error) fail("purgeOlderThan", inbound.error.message);
      return { messages: (system.count ?? 0) + (correspondence.count ?? 0), inbound: inbound.count ?? 0 };
    },
  };
}

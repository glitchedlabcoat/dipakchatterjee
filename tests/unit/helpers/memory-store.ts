// tests/unit/helpers/memory-store.ts
//
// In-memory EmailStore with the same guarantees the database gives the
// real one: unique dedupe_key / provider_email_id / provider_message_id,
// compare-and-set claims, draft edits and trash moves, and the shared
// "unresolved" rule. Timestamps come from the injected clock. No network.

import { randomUUID } from "node:crypto";
import type { EmailInboundRow, EmailMessageRow } from "@/types/domain";
import type { EmailSettings } from "@/lib/email/settings";
import { defaultEmailSettings } from "@/lib/email/settings";
import type { OfficeContact } from "@/lib/email/templates";
import type {
  ComplaintSummary,
  EmailStore,
  InboundInsert,
  NewEmailMessage,
  RetentionCutoffs,
  TrashState,
} from "@/lib/email/store";
import { isUnresolvedComplaint } from "@/lib/complaint-status";

const MAILBOX_TRASH_KINDS = ["compose", "reply", "test"];
const SYSTEM_RETENTION_KINDS = ["complaint_receipt", "office_notification", "reminder", "test"];
const CORRESPONDENCE_KINDS = ["compose", "reply"];

export type FakeComplaint = {
  id: string;
  created_at: string;
  expires_at: string;
  status: string;
  is_expired: boolean;
  contact_email: string | null;
  contact_phone: string | null;
  media: number;
};

export class MemoryStore implements EmailStore {
  settings: EmailSettings;
  office: OfficeContact = { email: "office@example.org", address: "Chanchal, Malda" };
  messages = new Map<string, EmailMessageRow>();
  inbound = new Map<string, EmailInboundRow>();
  complaints = new Map<string, FakeComplaint>();
  schedulerRuns: string[] = [];
  /** Method name -> error to throw on the next call. */
  failures = new Map<string, Error>();
  clock: () => Date;

  constructor(opts: { settings?: Partial<EmailSettings>; now?: () => Date } = {}) {
    this.clock = opts.now ?? (() => new Date());
    this.settings = { ...defaultEmailSettings(this.clock().getTime()), persisted: true, ...opts.settings };
  }

  private maybeFail(method: string) {
    const err = this.failures.get(method);
    if (err) {
      this.failures.delete(method);
      throw err;
    }
  }

  addComplaint(partial: Partial<FakeComplaint> = {}): FakeComplaint {
    const now = this.clock().getTime();
    const c: FakeComplaint = {
      id: randomUUID(),
      created_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 7 * 86_400_000).toISOString(),
      status: "unresolved",
      is_expired: false,
      contact_email: null,
      contact_phone: null,
      media: 0,
      ...partial,
    };
    this.complaints.set(c.id, c);
    return c;
  }

  messageList(): EmailMessageRow[] {
    return [...this.messages.values()];
  }

  private summary(c: FakeComplaint): ComplaintSummary {
    return {
      id: c.id,
      createdAt: c.created_at,
      expiresAt: c.expires_at,
      status: c.status,
      contactEmail: c.contact_email,
      phoneProvided: Boolean(c.contact_phone),
      attachmentCount: c.media,
    };
  }

  async loadSettings() {
    this.maybeFail("loadSettings");
    return structuredClone(this.settings);
  }

  async getOfficeContact() {
    return { ...this.office };
  }

  async insertMessage(input: NewEmailMessage) {
    this.maybeFail("insertMessage");
    const existing = this.messageList().find((m) => m.dedupe_key === input.dedupeKey);
    if (existing) return { id: existing.id, inserted: false };
    const now = this.clock().toISOString();
    const row: EmailMessageRow = {
      id: randomUUID(),
      kind: input.kind,
      dedupe_key: input.dedupeKey,
      status: input.status ?? "pending",
      complaint_id: input.complaintId ?? null,
      inbound_id: input.inboundId ?? null,
      to_addresses: [...input.toAddresses],
      from_header: input.fromHeader ?? null,
      reply_to: input.replyTo ?? null,
      subject: input.subject ?? null,
      body_text: input.bodyText ?? null,
      body_html: input.bodyHtml ?? null,
      extra_headers: input.extraHeaders ?? null,
      attempts: 0,
      next_attempt_at: now,
      claimed_at: null,
      first_attempt_at: null,
      last_error: input.lastError ?? null,
      provider_message_id: null,
      sent_at: null,
      last_event_at: null,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
      queued_at: input.status === "draft" ? null : now,
      trashed_at: null,
      trashed_by: null,
    };
    this.messages.set(row.id, row);
    return { id: row.id, inserted: true };
  }

  async getMessage(id: string) {
    const row = this.messages.get(id);
    return row ? structuredClone(row) : null;
  }

  async claimMessage(row: EmailMessageRow, patch: Partial<EmailMessageRow>) {
    const current = this.messages.get(row.id);
    if (!current || current.status !== row.status || current.attempts !== row.attempts || current.trashed_at) return null;
    const next = { ...current, ...patch } as EmailMessageRow;
    this.messages.set(row.id, next);
    return structuredClone(next);
  }

  async updateDraft(id: string, expectedUpdatedAt: string | null, patch: Partial<EmailMessageRow>) {
    this.maybeFail("updateDraft");
    const current = this.messages.get(id);
    if (!current || current.kind !== "compose" || current.status !== "draft" || current.trashed_at) return null;
    if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return null;
    const next = { ...current, ...patch } as EmailMessageRow;
    this.messages.set(id, next);
    return structuredClone(next);
  }

  async setMessageTrash(id: string, trash: TrashState) {
    const current = this.messages.get(id);
    if (!current || !MAILBOX_TRASH_KINDS.includes(current.kind)) return null;
    if (trash && (current.trashed_at || current.status === "pending" || current.status === "sending")) return null;
    if (!trash && !current.trashed_at) return null;
    const next = {
      ...current,
      trashed_at: trash?.at ?? null,
      trashed_by: trash?.by ?? null,
      updated_at: this.clock().toISOString(),
    };
    this.messages.set(id, next);
    return structuredClone(next);
  }

  async updateMessage(id: string, patch: Partial<EmailMessageRow>) {
    this.maybeFail("updateMessage");
    const current = this.messages.get(id);
    if (!current) return;
    if (patch.provider_message_id) {
      const clash = this.messageList().find((m) => m.provider_message_id === patch.provider_message_id && m.id !== id);
      if (clash) throw new Error("duplicate provider_message_id");
    }
    this.messages.set(id, { ...current, ...patch } as EmailMessageRow);
  }

  async listDueMessageIds(nowIso: string, staleIso: string, limit: number) {
    return this.messageList()
      .filter(
        (m) =>
          (m.status === "pending" && m.next_attempt_at <= nowIso) ||
          (m.status === "sending" && m.claimed_at !== null && m.claimed_at < staleIso)
      )
      .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
      .slice(0, limit)
      .map((m) => m.id);
  }

  async countMessagesSince(kinds: string[], sinceIso: string, toAddress?: string) {
    return this.messageList().filter(
      (m) =>
        kinds.includes(m.kind) &&
        m.queued_at !== null &&
        m.queued_at >= sinceIso &&
        (!toAddress || m.to_addresses.includes(toAddress))
    ).length;
  }

  async findMessageByProviderId(providerId: string) {
    const row = this.messageList().find((m) => m.provider_message_id === providerId);
    return row ? structuredClone(row) : null;
  }

  async getComplaint(id: string) {
    this.maybeFail("getComplaint");
    const c = this.complaints.get(id);
    return c ? this.summary(c) : null;
  }

  async listUnresolvedComplaints(nowIso: string, limit: number) {
    const now = Date.parse(nowIso);
    const all = [...this.complaints.values()]
      .filter((c) => isUnresolvedComplaint(c, now))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { total: all.length, items: all.slice(0, limit).map((c) => this.summary(c)) };
  }

  async insertInbound(row: InboundInsert) {
    this.maybeFail("insertInbound");
    const existing = [...this.inbound.values()].find((r) => r.provider_email_id === row.provider_email_id);
    if (existing) return { id: existing.id, inserted: false };
    const full: EmailInboundRow = {
      id: randomUUID(),
      provider_email_id: row.provider_email_id,
      message_id: row.message_id ?? null,
      from_address: row.from_address,
      from_name: row.from_name ?? null,
      to_addresses: row.to_addresses ?? [],
      cc_addresses: row.cc_addresses ?? [],
      reply_to_addresses: row.reply_to_addresses ?? [],
      subject: row.subject ?? null,
      text_body: null,
      html_body: null,
      body_truncated: false,
      body_status: "pending",
      body_fetch_attempts: 0,
      body_error: null,
      attachments: row.attachments ?? [],
      auth_spf: null,
      auth_dkim: null,
      auth_dmarc: null,
      is_read: false,
      received_at: row.received_at,
      created_at: this.clock().toISOString(),
      trashed_at: null,
      trashed_by: null,
    };
    this.inbound.set(full.id, full);
    return { id: full.id, inserted: true };
  }

  async getInbound(id: string) {
    const row = this.inbound.get(id);
    return row ? structuredClone(row) : null;
  }

  async updateInbound(id: string, patch: Partial<EmailInboundRow>) {
    const current = this.inbound.get(id);
    if (current) this.inbound.set(id, { ...current, ...patch } as EmailInboundRow);
  }

  async setInboundTrash(id: string, trash: TrashState) {
    const current = this.inbound.get(id);
    if (!current) return null;
    if (trash ? current.trashed_at : !current.trashed_at) return null;
    const next = { ...current, trashed_at: trash?.at ?? null, trashed_by: trash?.by ?? null };
    this.inbound.set(id, next);
    return structuredClone(next);
  }

  async listInboundIdsNeedingBody(limit: number, maxAttempts: number) {
    return [...this.inbound.values()]
      .filter((r) => r.body_status === "pending" && r.body_fetch_attempts < maxAttempts)
      .slice(0, limit)
      .map((r) => r.id);
  }

  async markSchedulerRun(nowIso: string) {
    this.schedulerRuns.push(nowIso);
    this.settings.schedulerLastRunAt = nowIso;
  }

  async purgeOlderThan(cutoffs: RetentionCutoffs) {
    let messages = 0;
    let inbound = 0;
    for (const [id, m] of this.messages) {
      if (["draft", "pending", "sending"].includes(m.status)) continue;
      const before = SYSTEM_RETENTION_KINDS.includes(m.kind)
        ? cutoffs.systemBefore
        : CORRESPONDENCE_KINDS.includes(m.kind)
          ? cutoffs.correspondenceBefore
          : null;
      if (before && m.created_at < before) {
        this.messages.delete(id);
        messages += 1;
      }
    }
    for (const [id, r] of this.inbound) {
      if (r.received_at < cutoffs.inboundBefore) {
        this.inbound.delete(id);
        inbound += 1;
      }
    }
    return { messages, inbound };
  }
}

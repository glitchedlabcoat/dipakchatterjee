// lib/email/config.ts
//
// Everything secret stays in environment variables (Render dashboard),
// never in the database or the admin UI:
//   RESEND_API_KEY         sends mail; reading received mail needs a key
//                          with "Full access" (a sending-only key can't)
//   RESEND_FROM_EMAIL      default sender, e.g.
//                          `Dipak Chatterjee <office@janatardipak.com>`.
//                          Its domain is treated as the verified domain:
//                          the settings page only accepts sender
//                          addresses on it, and the inbound webhook only
//                          stores mail addressed to it.
//   RESEND_WEBHOOK_SECRET  signing secret (whsec_…) of the Resend webhook
//                          pointed at /api/webhooks/resend
//   CRON_SECRET            bearer token for /api/cron/email
//   RESEND_INBOUND_ENABLED "true" turns receiving on (the Inbox). Unset,
//                          the webhook acknowledges `email.received`
//                          events and drops them: nothing is stored or
//                          fetched from Resend. The office doesn't
//                          receive mail at the domain yet; before turning
//                          this on, bound the received-body download in
//                          lib/email/resend.ts (it reads the whole JSON).
// The UI only ever learns whether each one is set.

import { domainOf, parseMailbox } from "@/lib/email/address";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getResendApiKey(): string | null {
  return env("RESEND_API_KEY");
}

export function getDefaultSender(): { name: string | null; address: string } | null {
  return parseMailbox(env("RESEND_FROM_EMAIL"));
}

export function getVerifiedDomain(): string | null {
  const sender = getDefaultSender();
  return sender ? domainOf(sender.address) : null;
}

export function getWebhookSecret(): string | null {
  return env("RESEND_WEBHOOK_SECRET");
}

export function getCronSecret(): string | null {
  return env("CRON_SECRET");
}

export function isInboundEnabled(): boolean {
  return env("RESEND_INBOUND_ENABLED") === "true";
}

export type ProviderStatus = {
  apiKeyConfigured: boolean;
  defaultSender: string | null;
  verifiedDomain: string | null;
  webhookConfigured: boolean;
  cronConfigured: boolean;
  inboundEnabled: boolean;
};

export function getProviderStatus(): ProviderStatus {
  const sender = getDefaultSender();
  return {
    apiKeyConfigured: Boolean(getResendApiKey()),
    defaultSender: sender?.address ?? null,
    verifiedDomain: sender ? domainOf(sender.address) : null,
    webhookConfigured: Boolean(getWebhookSecret()),
    cronConfigured: Boolean(getCronSecret()),
    inboundEnabled: isInboundEnabled(),
  };
}

# Email system: setup and operations

How the site's email works, what has to be configured before it does, and how to test and troubleshoot it. Written 2026-10-17 alongside the code; updated 2026-10-18 for the six Emails sections and all-administrator access. Secrets are never written here, only their names. A click-by-click setup guide for Resend and Hostinger is kept outside the repository (`outputs/RESEND_EMAIL_SETUP_GUIDE.md` in the working copy).

## What it does

| Feature | Where | Needs |
|---|---|---|
| **A. Citizen receipt.** An optional email field on `/complaints`. If filled, the citizen gets an email with the reference number, submission time and office contact. It never includes the complaint text, phone number, attachments or any link to the complaint. | `lib/email/complaint-emails.ts`, `templates.ts` | Migration, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| **B. Office notification.** Every new complaint emails the notification recipient its reference, time, attachment count, and a button to `/admin/complaints?complaint=<id>`. That page still requires a dashboard login; the link is not public. | same | same, plus a recipient set in Settings |
| **C. Reminders.** A summary of unresolved complaints, sent daily, weekly, monthly, every N days or every N months at a set time and timezone (default Asia/Kolkata). At most one email per scheduled occurrence. | `lib/email/schedule.ts`, `reminders.ts`, `/api/cron/email` | same, plus `CRON_SECRET` and a scheduler |
| **D. Inbound mail.** Mail sent to `@janatardipak.com` appears in the dashboard inbox and can be answered. | `/api/webhooks/resend`, `lib/email/inbound.ts` | Receiving enabled in Resend, an MX record, a webhook, `RESEND_WEBHOOK_SECRET`, a Full-access API key |
| **E. Dashboard.** `/admin/emails` has six sections: **Inbox**, **Drafts**, **Outbox**, **Sent**, **Trashed** and **New Message**, plus a Settings link (sender, recipient, toggles, schedule, a test email and the history of system emails). | `app/admin/(protected)/emails/`, rules in `lib/email/mailbox.ts` | Migration |

### The six sections

| Section | What it shows | Actions |
|---|---|---|
| Inbox | Received mail, not trashed. Search by sender or subject; unread filter. | Open, read safely, reply, mark unread, Move to Trashed |
| Drafts | Messages saved with **Save draft** in New Message (stored in the database, so they survive reloads, other browsers and redeploys; shared by all administrators). | Open to keep writing or send; Discard (to Trashed) |
| Outbox | An administrator's messages, replies and test emails that Resend hasn't accepted yet: queued, sending, failed, not sent. | Retry (failed/not sent); Move to Trashed (failed only, never while queued or sending) |
| Sent | The same, once Resend accepted them, with the latest delivery report (Accepted by Resend → Delivered / Delayed / Bounced / Marked as spam / Suppressed / Failed). | Open, Move to Trashed (doesn't recall the email) |
| Trashed | Anything moved there. Soft delete: nothing is removed. | Restore (back to the section it came from) |
| New Message | Composer: To (up to 10), Subject (200), plain-text Message (20,000). | Send, Save draft, Discard |

Citizen receipts, new-complaint notifications and reminders never appear in these sections; they're in Settings → System email history, so transactional complaint mail stays separate from manual mail.

**Access.** Every dashboard administrator (any profile, role ADMIN or USER) has full access to the whole Emails section: reading, drafting, sending, replying, retrying, trashing and Settings. Every server action checks `requireAdmin()` itself, the page layout redirects anyone without a profile to `/admin/login`, and the database's read policies use the same rule (`is_admin()` = "has a profile"). Nobody else (no session, or a session without a profile) can read or do anything. `requireOwner` is not used anywhere in the Emails section.

**Exactly-once sending.** A composition gets one id in the browser; its row's unique `dedupe_key` (`compose:<id>`) is also Resend's `Idempotency-Key`. Sending a draft is a compare-and-set from `draft` to `pending`, so a double-click, a retried request or two administrators pressing Send at once still send one email. Editing a draft checks the version you loaded (`updated_at`), so a save from an older tab is refused instead of overwriting newer text.

**Limits.** New messages and replies: 20 an hour and 50 a day, shared by all administrators, counted when a message enters the Outbox (`queued_at`), so drafts don't use the limit and old drafts can't be stockpiled past it. Test emails: 5 an hour.

### How sending works

Every email is first written to `email_messages` (an outbox), then sent through Resend's REST API.

- **Receipts and notifications** are sent straight after the complaint is saved, in the background, so the citizen never waits on Resend.
- **New messages, replies and test emails** are sent the moment you press Send.
- **Failures are retried by the scheduler** after 1 min, 5 min, 30 min, 2 h and 6 h. A message is given up on after 6 attempts or 23 hours. Each retry sends the same request with the same `Idempotency-Key`, so Resend never delivers a message twice.
- **Delivery reports from Resend** (delivered, bounced and so on) update each row's status, provided the webhook is set up.

## Status

| | Status |
|---|---|
| Code for A–E | Done. Type-check, lint and build pass; 89 unit tests; the migration tested on a disposable Postgres (PGlite); end-to-end and headless-browser runs against mock Supabase and Resend. |
| Tested against real Resend, Supabase or DNS | **No.** Nothing real has been sent or changed. |
| Database migration | **Prepared, not applied.** Needs approval (Step 1). |
| Render environment variables | **Not set by us.** Needs Render dashboard access (Step 2). |
| Resend webhook, receiving and DNS | **Not done.** Needs Resend and Hostinger access (Steps 3–4). |
| Scheduler | **Not set up.** Needs Supabase access and a choice of option (Step 5). |

Without the migration, the site keeps working as before:
- complaints save without the email address;
- no email is queued;
- `/admin/emails` shows a "run the migration" notice.

Deploying the code first is therefore safe, but applying the migration first is cleaner.

## Step 1: database migration (needs approval)

File: `supabase/migrations/20261017000000_email_system.sql` (one file covers everything, including drafts and Trashed). Run it in the Supabase SQL editor. It is additive and idempotent: it only creates tables and columns that don't already exist, and drops or rewrites no data. Its last section replaces only the `email_messages_status` check (to allow `draft`) and is there so the file can be re-run safely. Checked 2026-10-18: none of these tables existed in production yet.

- `complaints.contact_email` (text, nullable): the optional citizen email (already present live).
- `email_settings`: one row (`id = 'default'`) holding the sender, recipient, toggles, reminder schedule and the scheduler heartbeat. Defaults: confirmations on, notifications on, reminders **off**.
- `email_messages`: the outbox, the delivery log and the Drafts/Outbox/Sent sections. Its unique `dedupe_key` prevents duplicate receipts, notifications, reminders and sends; `status` includes `draft`; `queued_at` (when it entered the outbox, null for drafts) drives the sending limits; `trashed_at`/`trashed_by` are the soft delete behind Trashed.
- `email_inbound`: received mail, with `trashed_at`/`trashed_by`.
- RLS: users accepted by the existing `is_admin()` function (any dashboard profile) can read the three new tables, the same rule as `complaints`. There are no write policies; all writes go through the server's service-role client after `requireAdmin()`.
- Tested 2026-10-18 on a disposable Postgres (PGlite): fresh apply, re-apply, apply over the 10-17 version of the file, constraints, cascades, and RLS for ADMIN/USER profiles, a profile-less user and anon (14/14).

Before running it, check that the live `complaints` table looks like the repo's (`types/database.types.ts` is hand-maintained, so it may not match). After it runs, regenerating types should produce the same shapes that were added by hand.

## Step 2: environment variables (Render dashboard → Environment)

| Name | Purpose |
|---|---|
| `RESEND_API_KEY` | Sends mail. For the inbox, the key must have **Full access**; a "Sending access" key can send but probably can't download received messages, and the inbox shows that error if so. The same key is used by the admin login code (2FA). |
| `RESEND_FROM_EMAIL` | The default sender, e.g. `Dipak Chatterjee <office@janatardipak.com>`. Its domain must be verified in Resend. It also defines "our domain": Settings only accepts sender addresses on it, and the webhook only stores mail addressed to it or its subdomains. The admin login code uses it too, so changing it changes that sender. |
| `RESEND_WEBHOOK_SECRET` | The `whsec_…` signing secret of the Resend webhook (Step 3). Unset → `/api/webhooks/resend` returns 404. |
| `CRON_SECRET` | The bearer token the scheduler sends to `/api/cron/email` (and the existing `/api/cron/purge-complaints`). Unset → both routes return 404. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |

None of these go in the database, the repo or the admin UI. Settings only shows whether each one is set. The site URL used in email links is fixed in `lib/site-url.ts` (`https://janatardipak.com`).

## Step 3: Resend configuration (needs Resend access)

1. **Domain.** Resend → Domains → `janatardipak.com` must show **Verified**. DNS already has Resend's sending records (`send.janatardipak.com` and `resend._domainkey`), but the verification status could not be checked from here. Leave those records as they are.
2. **Webhook.** Resend → Webhooks → add the endpoint `https://janatardipak.com/api/webhooks/resend` with these events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `email.received`. Copy its signing secret into `RESEND_WEBHOOK_SECRET` on Render. The Free plan allows one webhook endpoint, and this single endpoint handles all of these events.
3. **Receiving (only for the inbox).** Turn on receiving for the domain. Resend then shows an MX record to add (Step 4). Mail is only accepted for the domain once that record exists.
4. **Plan limits.** The Free plan allows 3,000 emails a month and 100 a day, and **received mail counts toward the same quota**. A complaint with an email address uses 2 sends. If the daily cap is hit, messages wait and are retried after midnight UTC (the retry window is 23 hours). Pro is $20/month if volume grows. Resend's separate paid "Inboxes" product is not used.

## Step 4: DNS records (at Hostinger, not applied)

The domain's nameservers are Hostinger's (`dns-parking.com`). A lookup on 2026-10-17 found **no MX records**, so nothing receives `@janatardipak.com` mail today and adding one disrupts no existing mailbox.

| Record | Name | Value | When |
|---|---|---|---|
| MX | `@` (root) | Exactly what Resend shows after receiving is enabled, at the priority it gives | Only for the inbox (Feature D) |
| TXT (optional) | `_dmarc` | e.g. `v=DMARC1; p=none; rua=mailto:<an address you read>` | Recommended for deliverability; start with `p=none` |

To keep the root domain free of MX records, receiving can instead go on a subdomain (e.g. `inbox.janatardipak.com`). Addresses then become `…@inbox.janatardipak.com`, which the code already accepts.

## Step 5: scheduler

`/api/cron/email` does one "tick":
1. queue a due reminder;
2. send due messages and retries;
3. fetch inbound bodies the webhook couldn't;
4. apply retention;
5. record a heartbeat.

Every step is idempotent, so extra or overlapping calls are harmless. The route needs something outside the web process to call it, because Render free instances sleep and lose in-memory timers.

| Option | Cost | Notes |
|---|---|---|
| **Supabase pg_cron + pg_net** (recommended) | Free (included in the Supabase plan) | Script: `supabase/snippets/email-scheduler-pg-cron.sql`. Calls every 15 minutes with the secret read from Supabase Vault. The 60-second timeout covers a Render cold start. Needs approval, since it runs SQL on the live project. |
| Render Cron Job | Paid, about $1/month minimum | Needs approval for the cost. It would run `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://janatardipak.com/api/cron/email`. |
| Any other HTTP scheduler that can send a header | Varies | Another outside service, so it needs approval. |

Notes:
- A call every 15 minutes also keeps the free Render instance awake, much like the existing `/api/ping` keep-alive. One always-on instance uses about 744 of Render's 750 free hours a month.
- If the scheduler misses a reminder time (site asleep, outage), the next tick sends **that occurrence's** reminder once, late. It never sends a backlog. Changing the schedule never back-fills occurrences from before the change.
- Settings → **Scheduler** shows the last run and warns if it's more than 2 hours old.
- Without a scheduler: receipts, notifications, new messages and tests still send immediately. Reminders and retries do not happen.

## Configuring sender and recipient

In `/admin/emails/settings` (any dashboard administrator):

- **Sender name / Sender address.** The address must be on the verified domain. Leave it blank to use `RESEND_FROM_EMAIL`.
- **Reply-to address.** Where citizens' replies go. **It must be a mailbox that actually receives mail.** Until receiving (Step 3–4) is set up, `@janatardipak.com` addresses receive nothing, so use an address the office reads (e.g. its Gmail).
- **Notification recipient.** Mr. Dipak's address, for new-complaint notifications and reminders. Required while either of those is on.
- **Toggles:** "Notify the office about every new complaint", "Email citizens a receipt", and "Send reminders" (off by default).
- **Reminder schedule.** Frequency, time, timezone, and weekday, day of month (29–31 fall back to a shorter month's last day), or interval and start date. The form previews the next send time.

## Testing safely

Never use a real citizen's address for a test.

1. **Locally, with no network:** run `npm test`. That's 89 tests; Resend and Supabase are mocked.
2. **After deploying:**
   1. Go to Settings → **Send a test email to myself**. It only goes to the signed-in administrator's own login address (limit 5 an hour).
3. **To test a citizen receipt:**
   1. In Settings, temporarily point **Notification recipient** at your own address, or untick office notifications, so Mr. Dipak isn't emailed.
   2. Submit a complaint on `/complaints` with **your own** email.
   3. Check the inbox, then the receipt row in Settings → System email history.
   4. Restore the setting.
   5. Mark the test complaint resolved or delete it.
   6. Receipts are capped at 3 per address per day and 20 per hour site-wide.
4. **To check bounce handling without a real recipient:** send a New message to Resend's test addresses, `delivered@resend.dev`, `bounced@resend.dev` or `complained@resend.dev`. With the webhook connected, the row's status should change to delivered, bounced or complained.
5. **To test the inbox,** once receiving is live: send a message from your own mailbox to an `@janatardipak.com` address.

## Inspecting delivery failures

1. **Outbox and Sent** for your own messages; **Settings → System email history** for receipts, notifications and reminders.
   - Shows the last 50 messages; "Problems only" filters to failures.
   - Each row shows its status, attempts and last error. Citizen addresses are masked.
   - **Retry** re-queues a failed or skipped message. It re-sends the same request with the same idempotency key, so if Resend had in fact accepted it within the last 24 hours, it is not delivered twice.

   | Status | Meaning |
   |---|---|
   | pending | Waiting to be sent or retried |
   | sending | In progress; a stuck row is picked up again after 10 minutes |
   | sent | Accepted by Resend |
   | delivered | The receiving server accepted it |
   | delivery_delayed | The receiving server is deferring it; Resend keeps trying |
   | bounced | Rejected by the receiving server |
   | complained | Marked as spam by the recipient |
   | suppressed | Resend refused because the address bounced or complained before |
   | failed | Resend refused, or attempts or time ran out (see the error) |
   | skipped | Deliberately not sent (e.g. receipt cap reached, no recipient set) |

2. **Resend dashboard.** Emails (search by recipient) for delivery details. Logs for rejected API calls. Webhooks for whether events reached the site.
3. **Render logs.** Search for `[email-outbox]`, `[email-dispatch]`, `[complaint-emails]`, `[resend-webhook]`, `[email-inbound]`, `[emails/actions]` and `[submitComplaint]`. Log lines hold message IDs, statuses and error messages, not message content.
4. **Supabase SQL**, for the scheduler: the queries at the end of the pg_cron snippet show job runs and HTTP responses. For messages:

   ```sql
   select created_at, kind, status, attempts, last_error
   from email_messages
   where status in ('failed', 'bounced', 'complained', 'suppressed', 'skipped')
   order by created_at desc limit 50;
   ```

## Retention and privacy

- **Retention:**
  - System emails (receipts, notifications, reminders, test emails) are deleted after 90 days.
  - An administrator's sent messages and replies are deleted after 365 days, like received mail.
  - Drafts are never deleted automatically, and moving something to Trashed doesn't shorten its life.
  - Received mail is deleted after 365 days.
  - Rows linked to a complaint are deleted with the complaint.
  - Retention only runs when the scheduler does.
- **Privacy notice:** `/privacy` (last updated 18 October 2026) describes the email field, the receipt, Resend as a processor, and that email exchanged with the office is kept up to a year. **Mr. Dipak should approve the wording before go-live.**
- **Received HTML** is sanitised: scripts, forms, style blocks, tracking pixels and remote images are removed, and only http(s) and mailto links are kept. It is shown in a sandboxed frame; plain text is the default view. Attachments are listed (name, type, size) but not downloadable yet.

## Rollback

- Unset `CRON_SECRET` or `RESEND_WEBHOOK_SECRET` → the matching route returns 404.
- Untick the toggles in Settings → nothing new is queued.
- The migration is additive. Leaving it in place after a code rollback is harmless, because the old code ignores the new tables and column.

## Known gaps

- After signing in from an email's admin link, login lands on `/admin`, not the linked complaint.
- Inbound attachments are metadata only.
- Reminders list at most 50 complaints (the count shows the total).
- Trashed shows the 50 most recently trashed items (the count shows the total).
- Admin pages stream (`app/admin/(protected)/loading.tsx`), so an unknown message id shows the "Page not found" screen with HTTP 200 rather than 404. Nothing about the message is shown.

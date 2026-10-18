// lib/email/templates.ts
//
// HTML + plain-text bodies for every email the site sends (the admin
// login OTP keeps its own template in lib/notify/email.ts). Table layout
// with inline styles, the same approach as the OTP mail, because that's
// what email clients reliably render.
//
// Every interpolated value goes through escapeHtml(). What is
// deliberately never put in any of these emails: a complaint's
// description, phone number, the citizen's email address (in office
// mail), attachment links or anything else from the complaint body.
// Office emails link to the signed-in dashboard instead.

import { formatInZone } from "@/lib/email/schedule";

const BRAND_NAVY = "#151F33";
const BRAND_SAFFRON = "#C1832B";
const MUTED = "#6b7280";
const TEXT = "#1f2937";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subject lines are single-line and bounded; CR/LF would start a new header. */
export function cleanSubject(value: string, max = 200): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function paragraph(html: string, extra = ""): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};${extra}">${html}</p>`;
}

function smallText(html: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="background-color:${BRAND_NAVY};border-radius:8px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function referenceBox(reference: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
<td align="center" style="background-color:#f3f4f6;border-radius:10px;padding:20px 12px;">
<span style="display:block;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">Reference number</span>
<span style="display:inline-block;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:2px;color:${BRAND_NAVY};font-family:'Courier New',Courier,monospace;">${escapeHtml(reference)}</span>
</td></tr></table>`;
}

function layout(opts: { brandName: string; tagline: string; title: string; bodyHtml: string; footerHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background-color:${BRAND_NAVY};padding:22px 32px;">
                <p style="margin:0;font-size:18px;line-height:1.3;color:#ffffff;font-weight:700;">
                  ${escapeHtml(opts.brandName)} <span style="color:${BRAND_SAFFRON};font-weight:600;">| ${escapeHtml(opts.tagline)}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;">${opts.footerHtml}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type OfficeContact = { email: string | null; address: string | null };

function officeContactHtml(contact: OfficeContact): string {
  const lines: string[] = [];
  if (contact.email) {
    lines.push(`Email: <a href="mailto:${escapeHtml(contact.email)}" style="color:${BRAND_NAVY};">${escapeHtml(contact.email)}</a>`);
  }
  if (contact.address) lines.push(escapeHtml(contact.address).replace(/\r?\n/g, "<br />"));
  if (lines.length === 0) return "";
  return `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:${TEXT};">Office contact</p>${smallText(lines.join("<br />"))}`;
}

function officeContactText(contact: OfficeContact): string[] {
  const lines: string[] = [];
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.address) lines.push(contact.address);
  return lines.length ? ["Office contact", ...lines, ""] : [];
}

// ---------------------------------------------------------------------------
// Feature A: citizen confirmation

export function renderComplaintReceipt(opts: {
  brandName: string;
  reference: string;
  submittedAt: Date;
  timeZone: string;
  office: OfficeContact;
  siteUrl: string;
}): RenderedEmail {
  const when = formatInZone(opts.submittedAt.getTime(), opts.timeZone);
  const subject = cleanSubject(`We received your complaint (${opts.reference})`);

  const bodyHtml = [
    paragraph("Thank you for contacting the office. This email confirms that your complaint has been <strong>received</strong>."),
    referenceBox(opts.reference),
    paragraph(`<strong>Submitted:</strong> ${escapeHtml(when)}`),
    paragraph("Please keep this reference number. Quote it whenever you contact the office about this complaint."),
    paragraph(
      "This is an acknowledgement of receipt only. It does not mean the complaint has been reviewed, and it does not guarantee any particular outcome or response time. If the office needs more information, it may contact you using the details you provided.",
      `color:${MUTED};font-size:14px;`
    ),
    officeContactHtml(opts.office),
  ].join("\n");

  const footerHtml = `You are receiving this because this email address was entered on the complaint form at ${escapeHtml(
    opts.siteUrl.replace(/^https?:\/\//, "")
  )}. If that wasn't you, you can ignore this email. This is an automated message; please don&rsquo;t share your reference number with anyone you don&rsquo;t trust.`;

  const text = [
    `${opts.brandName} | Complaint received`,
    "",
    "Thank you for contacting the office. This email confirms that your complaint has been received.",
    "",
    `Reference number: ${opts.reference}`,
    `Submitted: ${when}`,
    "",
    "Please keep this reference number. Quote it whenever you contact the office about this complaint.",
    "",
    "This is an acknowledgement of receipt only. It does not mean the complaint has been reviewed, and it does not guarantee any particular outcome or response time. If the office needs more information, it may contact you using the details you provided.",
    "",
    ...officeContactText(opts.office),
    "---",
    `You are receiving this because this email address was entered on the complaint form at ${opts.siteUrl.replace(/^https?:\/\//, "")}. If that wasn't you, you can ignore this email.`,
  ].join("\n");

  return {
    subject,
    html: layout({ brandName: opts.brandName, tagline: "Complaint received", title: subject, bodyHtml, footerHtml }),
    text,
  };
}

// ---------------------------------------------------------------------------
// Feature B: office notification

export function renderOfficeNotification(opts: {
  brandName: string;
  reference: string;
  submittedAt: Date;
  timeZone: string;
  adminUrl: string;
  attachmentCount: number;
  phoneProvided: boolean;
  emailProvided: boolean;
}): RenderedEmail {
  const when = formatInZone(opts.submittedAt.getTime(), opts.timeZone);
  const subject = cleanSubject(`New complaint ${opts.reference}`);
  const contact = [opts.phoneProvided ? "phone number" : null, opts.emailProvided ? "email address" : null].filter(Boolean);
  const contactLine = contact.length ? `The citizen left a ${contact.join(" and ")}.` : "The citizen left no contact details.";
  const attachments =
    opts.attachmentCount === 0 ? "No attachments." : `${opts.attachmentCount} attachment${opts.attachmentCount === 1 ? "" : "s"}.`;

  const bodyHtml = [
    paragraph("A new complaint was submitted through the website."),
    referenceBox(opts.reference),
    paragraph(`<strong>Submitted:</strong> ${escapeHtml(when)}`),
    paragraph(`${escapeHtml(contactLine)} ${escapeHtml(attachments)}`, `color:${MUTED};font-size:14px;`),
    button(opts.adminUrl, "Open in the dashboard"),
    smallText(
      "The details are only in the dashboard, which requires you to sign in. They are not included in this email on purpose."
    ),
  ].join("\n");

  const text = [
    `${opts.brandName} | New complaint`,
    "",
    "A new complaint was submitted through the website.",
    "",
    `Reference number: ${opts.reference}`,
    `Submitted: ${when}`,
    `${contactLine} ${attachments}`,
    "",
    `Open in the dashboard (sign-in required): ${opts.adminUrl}`,
    "",
    "The details are only in the dashboard. They are not included in this email on purpose.",
  ].join("\n");

  return {
    subject,
    html: layout({
      brandName: opts.brandName,
      tagline: "Office notification",
      title: subject,
      bodyHtml,
      footerHtml: "Automated notification from the website's complaint form. Turn it off under Admin &gt; Emails &gt; Settings.",
    }),
    text,
  };
}

// ---------------------------------------------------------------------------
// Feature C: unresolved-complaint reminder

export type ReminderItem = { reference: string; submittedAt: Date; adminUrl: string };

function ageLabel(submittedAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - submittedAt.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "less than a day old";
  return `${days} day${days === 1 ? "" : "s"} old`;
}

export function renderReminder(opts: {
  brandName: string;
  items: ReminderItem[];
  total: number;
  now: Date;
  timeZone: string;
  complaintsUrl: string;
  scheduleLabel: string;
}): RenderedEmail {
  const { items, total } = opts;
  const subject =
    total === 0
      ? "Reminder: no unresolved complaints"
      : `Reminder: ${total} unresolved complaint${total === 1 ? "" : "s"}`;

  const rowsHtml = items
    .map((item) => {
      const when = formatInZone(item.submittedAt.getTime(), opts.timeZone);
      return `<tr>
<td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:700;color:${BRAND_NAVY};white-space:nowrap;">
<a href="${escapeHtml(item.adminUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(item.reference)}</a></td>
<td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:${TEXT};">${escapeHtml(when)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:${MUTED};white-space:nowrap;">${escapeHtml(ageLabel(item.submittedAt, opts.now))}</td>
</tr>`;
    })
    .join("\n");

  const more = total > items.length ? total - items.length : 0;

  const bodyHtml =
    total === 0
      ? [
          paragraph("There are <strong>no unresolved complaints</strong> right now. Nothing needs your attention."),
          button(opts.complaintsUrl, "Open complaints"),
        ].join("\n")
      : [
          paragraph(
            `There ${total === 1 ? "is" : "are"} <strong>${total} unresolved complaint${total === 1 ? "" : "s"}</strong> that ${
              total === 1 ? "has" : "have"
            } not been marked resolved and ${total === 1 ? "has" : "have"} not expired.`
          ),
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
<tr><th align="left" style="padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${MUTED};">Reference</th>
<th align="left" style="padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${MUTED};">Submitted</th>
<th align="left" style="padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${MUTED};">Age</th></tr>
${rowsHtml}
</table>`,
          more > 0 ? smallText(`…and ${more} more in the dashboard.`) : "",
          button(opts.complaintsUrl, "Open complaints"),
          smallText("Each reference opens that complaint in the dashboard, which requires you to sign in."),
        ].join("\n");

  const textLines =
    total === 0
      ? ["There are no unresolved complaints right now. Nothing needs your attention.", "", `Complaints: ${opts.complaintsUrl}`]
      : [
          `There ${total === 1 ? "is" : "are"} ${total} unresolved complaint${total === 1 ? "" : "s"}:`,
          "",
          ...items.map(
            (item) =>
              `- ${item.reference} | submitted ${formatInZone(item.submittedAt.getTime(), opts.timeZone)} | ${ageLabel(
                item.submittedAt,
                opts.now
              )}\n  ${item.adminUrl}`
          ),
          ...(more > 0 ? ["", `...and ${more} more in the dashboard.`] : []),
          "",
          `All complaints (sign-in required): ${opts.complaintsUrl}`,
        ];

  const text = [`${opts.brandName} | Reminder`, "", ...textLines, "", "---", `Schedule: ${opts.scheduleLabel}`].join("\n");

  return {
    subject,
    html: layout({
      brandName: opts.brandName,
      tagline: "Complaint reminder",
      title: subject,
      bodyHtml,
      footerHtml: `Scheduled reminder (${escapeHtml(opts.scheduleLabel)}). Change or turn it off under Admin &gt; Emails &gt; Settings.`,
    }),
    text,
  };
}

// ---------------------------------------------------------------------------
// Admin-written messages (compose, reply) and the test email

/** Plain text in, escaped HTML out: paragraphs on blank lines, <br> on single newlines. */
export function textToHtml(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => paragraph(escapeHtml(block).replace(/\n/g, "<br />")))
    .join("\n");
}

export function renderPlainMessage(opts: { brandName: string; subject: string; body: string }): RenderedEmail {
  const subject = cleanSubject(opts.subject);
  return {
    subject,
    html: layout({
      brandName: opts.brandName,
      tagline: "Office",
      title: subject,
      bodyHtml: textToHtml(opts.body),
      footerHtml: `Sent by ${escapeHtml(opts.brandName)}&rsquo;s office.`,
    }),
    text: opts.body.replace(/\r\n?/g, "\n"),
  };
}

export function renderTestEmail(opts: { brandName: string; sentAt: Date; timeZone: string }): RenderedEmail {
  const when = formatInZone(opts.sentAt.getTime(), opts.timeZone);
  const subject = "Test email from the website dashboard";
  return {
    subject,
    html: layout({
      brandName: opts.brandName,
      tagline: "Test",
      title: subject,
      bodyHtml: [
        paragraph("This is a test email sent from Admin &gt; Emails &gt; Settings."),
        paragraph(`If you can read this, sending through Resend works. Sent ${escapeHtml(when)}.`),
      ].join("\n"),
      footerHtml: "Only a signed-in dashboard administrator can send this test, and only to their own address.",
    }),
    text: [
      "This is a test email sent from Admin > Emails > Settings.",
      "",
      `If you can read this, sending through Resend works. Sent ${when}.`,
    ].join("\n"),
  };
}

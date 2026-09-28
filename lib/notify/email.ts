// lib/notify/email.ts
//
// Sends the login OTP by email via Resend's REST API (no SDK
// dependency needed — it's a single authenticated POST). Resolves to a
// soft failure rather than throwing when RESEND_API_KEY isn't set, for
// the same reason as lib/notify/sms.ts: a missing channel shouldn't be
// able to lock the admin out on its own.

const BRAND_NAME = "Dipak Chatterjee";
const BRAND_NAVY = "#151F33";
const BRAND_SAFFRON = "#C1832B";
const CODE_BG = "#f3f4f6";

export type EmailResult = { sent: boolean; skipped: boolean; error?: string };

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }) + " IST";
}

// Table-based layout with every style inline: the two things email
// clients (Outlook/Gmail/etc.) reliably support, unlike flexbox/grid or
// a <style> block, which many strip or ignore entirely.
// Exported so the template can be rendered on its own (e.g. a preview
// or a test) — not used anywhere else in the app.
export function buildOtpEmailHtml(code: string, timestamp: string): string {
  const digits = code.split("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BRAND_NAME} admin login code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background-color:${BRAND_NAVY};padding:24px 32px;">
                <p style="margin:0;font-size:18px;line-height:1.3;color:#ffffff;font-weight:700;">
                  ${BRAND_NAME} <span style="color:${BRAND_SAFFRON};font-weight:600;">| Admin Portal</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">
                  A sign-in attempt to the ${BRAND_NAME} admin dashboard was just made and needs
                  verification. Enter the code below to continue.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background-color:${CODE_BG};border-radius:10px;padding:24px 12px;">
                      <span style="display:inline-block;font-size:36px;line-height:1;font-weight:700;letter-spacing:10px;color:${BRAND_NAVY};font-family:'Courier New',Courier,monospace;">
                        ${digits.join("")}
                      </span>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                  This code <strong>expires in 5 minutes</strong> and can only be used once. Never
                  share it with anyone — no one from ${BRAND_NAME}&rsquo;s office will ever ask you for it.
                  If you didn&rsquo;t request this code, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;">
                  This is an automated message from the ${BRAND_NAME} admin dashboard — please don&rsquo;t
                  reply to it. Sent ${timestamp}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildOtpEmailText(code: string, timestamp: string): string {
  return [
    `${BRAND_NAME} | Admin Portal`,
    "",
    "A sign-in attempt to the admin dashboard was just made and needs verification.",
    "",
    `Your verification code: ${code}`,
    "",
    "This code expires in 5 minutes and can only be used once. Never share it with",
    "anyone. If you didn't request this code, you can safely ignore this email.",
    "",
    "---",
    `Automated message from the ${BRAND_NAME} admin dashboard. Sent ${timestamp}.`,
  ].join("\n");
}

export async function sendOtpEmail(toEmail: string, code: string): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return { sent: false, skipped: true };

  const timestamp = formatTimestamp(new Date());

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: `${code} is your ${BRAND_NAME} admin verification code`,
        html: buildOtpEmailHtml(code, timestamp),
        text: buildOtpEmailText(code, timestamp),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { sent: false, skipped: false, error: `Resend ${res.status}: ${body}` };
    }

    return { sent: true, skipped: false };
  } catch (err) {
    return { sent: false, skipped: false, error: err instanceof Error ? err.message : "Resend request failed" };
  }
}

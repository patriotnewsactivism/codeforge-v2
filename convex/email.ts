/**
 * email.ts — CodeForge Email Provider
 *
 * Self-owned email via Resend (resend.com).
 * Self-owned email auth provider via Resend.
 *
 * Required env var: RESEND_API_KEY
 * Optional env var: EMAIL_FROM (defaults to onboarding@resend.dev for testing,
 *   set to your verified domain address in production e.g. auth@codeforge.app)
 */

import { Email } from "@convex-dev/auth/providers/Email";
import { APP_NAME } from "./constants";

declare const process: { env: Record<string, string | undefined> };

function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1_000_000).padStart(6, "0");
}

async function sendEmail({
  email,
  token,
  subject,
  heading,
  description,
}: {
  email: string;
  token: string;
  subject: string;
  heading: string;
  description: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. Add it to your Convex environment variables."
    );
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                ⚡ ${APP_NAME}
              </span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">${heading}</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#888;line-height:1.6;">${description}</p>
              <!-- OTP Code -->
              <div style="background:#0f0f0f;border:1px solid #333;border-radius:8px;padding:20px;text-align:center;margin-bottom:28px;">
                <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:700;color:#a78bfa;letter-spacing:8px;">${token}</span>
              </div>
              <p style="margin:0;font-size:13px;color:#555;line-height:1.5;">
                This code expires in <strong style="color:#888;">15 minutes</strong>.<br>
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #2a2a2a;">
              <p style="margin:0;font-size:12px;color:#444;">
                Sent by ${APP_NAME} &mdash; The autonomous coding platform
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `${heading}\n\n${description}\n\nYour code: ${token}\n\nExpires in 15 minutes.\n\n---\nSent by ${APP_NAME}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: `${subject} — ${APP_NAME}`,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json() as { id?: string; error?: { message?: string } };
  if (json.error) throw new Error(`Resend error: ${json.error.message}`);
}

/**
 * CodeForgeEmail — OTP verification for sign-up / sign-in.
 */
export const CodeForgeEmail = Email({
  id: "codeforge-email",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateOTP();
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Verify your email",
      heading: "Verify your email",
      description: "Enter this code to complete sign-in:",
    });
  },
});

/**
 * CodeForgePasswordReset — OTP for password resets.
 */
export const CodeForgePasswordReset = Email({
  id: "codeforge-password-reset",
  maxAge: 60 * 15,
  async generateVerificationToken() {
    return generateOTP();
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Reset your password",
      heading: "Reset your password",
      description: "Enter this code to set a new password:",
    });
  },
});

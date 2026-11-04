import "server-only";

import nodemailer from "nodemailer";

/**
 * Outbound mail. SMTP (Zoho Mail) is used when SMTP_HOST is set; otherwise Resend's HTTP API
 * when RESEND_API_KEY is set; otherwise nothing is sent. A mail failure never throws: callers
 * carry on and show the person whether it went out.
 */
export type MailInput = {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
};

export const MAIL_FROM = process.env.MAIL_FROM || "Red Leaf Fintech <info@redleaffintech.com>";

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
}

async function sendSmtp(input: MailInput): Promise<{ sent: boolean; reason?: string }> {
  const port = Number(process.env.SMTP_PORT || 465);
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({
      from: MAIL_FROM,
      to: input.to,
      cc: input.cc?.length ? input.cc : undefined,
      replyTo: "info@redleaffintech.com",
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { sent: true };
  } catch (error) {
    console.error("[mail] SMTP send failed", error);
    return { sent: false, reason: "The mail server refused or could not be reached." };
  }
}

export async function sendMail(input: MailInput): Promise<{ sent: boolean; reason?: string }> {
  if (process.env.SMTP_HOST) return sendSmtp(input);
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "Email is not configured on this server." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [input.to],
        cc: input.cc?.length ? input.cc : undefined,
        reply_to: "info@redleaffintech.com",
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      console.error("[mail] Resend rejected the message", response.status, detail);
      return { sent: false, reason: `The mail service refused the message (${response.status}).` };
    }
    return { sent: true };
  } catch (error) {
    console.error("[mail] send failed", error);
    return { sent: false, reason: "The mail service could not be reached." };
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

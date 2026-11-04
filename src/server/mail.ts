import "server-only";

/**
 * Outbound mail through Resend's HTTP API (no SDK, no extra dependency).
 *
 * Inert until RESEND_API_KEY is set, and the sending domain (redleaffintech.com) must be
 * verified in Resend for MAIL_FROM to be accepted. A mail failure never throws: callers
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
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(input: MailInput): Promise<{ sent: boolean; reason?: string }> {
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

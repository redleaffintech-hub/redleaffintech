"use server";

import { z } from "zod";

/**
 * Contact enquiries.
 *
 * There is no mail service or CRM connected yet — the client has not told us
 * where enquiries should land. Rather than pretending a submission was
 * delivered, the action forwards to CONTACT_FORWARD_URL when one is configured
 * (any webhook that accepts JSON: an email relay, Slack, a form service), and
 * otherwise returns an honest fallback pointing at the published address.
 *
 * To go live, set CONTACT_FORWARD_URL and, if you want the address on the page
 * to change, CONTACT_EMAIL.
 */

const schema = z.object({
  name: z.string().trim().min(2, "Please give your name.").max(120),
  email: z.string().trim().toLowerCase().email("That email address does not look right."),
  company: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  topic: z.string().trim().max(60).optional(),
  message: z.string().trim().min(10, "Please tell us a little more.").max(4000),
});

export type ContactResult = { ok: true } | { error: string; fallbackEmail?: string };

export async function submitContactAction(formData: FormData): Promise<ContactResult> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
    topic: formData.get("topic") || undefined,
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  const target = process.env.CONTACT_FORWARD_URL;
  const fallbackEmail = process.env.CONTACT_EMAIL ?? "hello@redleaffintech.com";

  if (!target) {
    return {
      error: "This form is not connected to a mailbox yet. Please email us directly and we will reply the same day.",
      fallbackEmail,
    };
  }

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed.data, receivedAt: new Date().toISOString(), source: "redleaffintech.com/contact" }),
    });
    if (!response.ok) throw new Error(`Forwarder returned ${response.status}`);
    return { ok: true };
  } catch {
    return {
      error: "We could not send that just now. Please email us directly and we will pick it up.",
      fallbackEmail,
    };
  }
}

"use server";

import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Contact enquiries.
 *
 * Every enquiry is saved to the database and read by Super Admins under
 * Admin → Enquiries. When CONTACT_FORWARD_URL is configured it is also forwarded
 * (any webhook that accepts JSON: an email relay, Slack, a form service). The
 * visitor is only told it failed when it could be neither saved nor forwarded.
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
  const fallbackEmail = process.env.CONTACT_EMAIL ?? "info@redleaffintech.com";

  // The enquiry is always kept first, so it reaches the team (Admin → Enquiries)
  // even when no forwarding webhook is configured or the webhook is down.
  let saved = true;
  try {
    await db.contactEnquiry.create({ data: parsed.data });
  } catch (error) {
    saved = false;
    console.error("Could not save contact enquiry", error);
    if (!target) {
      return { error: "We could not send that just now. Please email us directly and we will pick it up.", fallbackEmail };
    }
  }

  if (!target) return { ok: true };

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed.data, receivedAt: new Date().toISOString(), source: "redleaffintech.com/contact" }),
    });
    if (!response.ok) throw new Error(`Forwarder returned ${response.status}`);
    return { ok: true };
  } catch {
    if (saved) return { ok: true };
    return {
      error: "We could not send that just now. Please email us directly and we will pick it up.",
      fallbackEmail,
    };
  }
}

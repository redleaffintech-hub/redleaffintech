"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSession, verifyPassword } from "@/server/auth/session";
import { getUserByEmail } from "@/server/db/users";
import { recordAudit } from "@/server/db/audit-logs";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await getUserByEmail(parsed.data.email.toLowerCase());
  // Same message either way so the form never confirms which emails exist.
  const invalid = { error: "Those credentials do not match an account." };
  if (!user) return invalid;
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return invalid;

  const headerList = await headers();
  await createSession(user.id, {
    userAgent: headerList.get("user-agent") ?? undefined,
    ip: headerList.get("x-forwarded-for") ?? undefined,
  });

  if (user.activeCompanyId) {
    await recordAudit({
      companyId: user.activeCompanyId,
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      summary: `${user.email} signed in`,
    });
  }

  redirect("/dashboard");
}

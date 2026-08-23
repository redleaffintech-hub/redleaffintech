"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createClient, normalizeEmail, setReadOnly, updateClient } from "@/server/admin/clients";
import {
  changeMembershipRole,
  grantMembership,
  removeMembership,
  setMembershipStatus,
} from "@/server/admin/users";
import { assignPlan } from "@/server/admin/subscriptions";
import { bool, int, optionalStr, runAdminAction, str } from "@/server/admin/run-action";

/**
 * Client-company mutations.
 *
 * Every one of these goes through `runAdminAction`, which supplies the
 * authorisation check, the CSRF check and the error translation. The bodies
 * below therefore contain only what is specific to the change itself.
 *
 * Provisioning is the exception to the "actions are thin" rule in one respect:
 * it returns the generated temporary password in its result so the page can show
 * it exactly once. That value is never written to a log, never stored in
 * readable form, and never sent anywhere else.
 */

export async function createClientAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const seatOverrideRaw = int(data, "seatOverride");
    const result = await createClient(actor, {
      name: str(data, "name"),
      legalName: optionalStr(data, "legalName"),
      email: optionalStr(data, "email"),
      phone: optionalStr(data, "phone"),
      country: optionalStr(data, "country") ?? "CA",
      province: str(data, "province") || "ON",
      baseCurrency: optionalStr(data, "baseCurrency"),
      fiscalYearStartMonth: int(data, "fiscalYearStartMonth", 1) ?? 1,
      industry: optionalStr(data, "industry"),
      primaryUserName: str(data, "primaryUserName"),
      primaryUserEmail: str(data, "primaryUserEmail"),
      planCode: str(data, "planCode"),
      billingCycle: str(data, "billingCycle") || "MONTHLY",
      trialDays: int(data, "trialDays", 30) ?? 30,
      seatOverride: seatOverrideRaw && seatOverrideRaw > 0 ? seatOverrideRaw : null,
      seatOverrideReason: optionalStr(data, "seatOverrideReason") ?? null,
    });

    revalidatePath("/admin/clients");
    revalidatePath("/admin");

    // The one-time secret cannot survive a redirect, so the page stays put and
    // shows it. Navigating away is the operator's decision, once they have it.
    const parts = [`${result.attachedExistingUser ? "Attached" : "Created"} the primary user.`];
    if (result.temporaryPassword) {
      parts.push(`Temporary password: ${result.temporaryPassword}`);
    } else if (result.attachedExistingUser) {
      parts.push("They already had an account, so their existing password still applies.");
    }

    return { ok: true, message: `Client provisioned. ${parts.join(" ")}` };
  });
}

export async function updateClientAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const companyId = str(data, "companyId");
    await updateClient(actor, {
      companyId,
      name: str(data, "name"),
      legalName: optionalStr(data, "legalName"),
      email: optionalStr(data, "email"),
      phone: optionalStr(data, "phone"),
      website: optionalStr(data, "website"),
      addressLine1: optionalStr(data, "addressLine1"),
      addressLine2: optionalStr(data, "addressLine2"),
      city: optionalStr(data, "city"),
      postalCode: optionalStr(data, "postalCode"),
      province: str(data, "province") || "ON",
      country: optionalStr(data, "country") ?? "CA",
      baseCurrency: optionalStr(data, "baseCurrency"),
      industry: optionalStr(data, "industry"),
      businessNumber: optionalStr(data, "businessNumber"),
    });

    revalidatePath(`/admin/clients/${companyId}`);
    revalidatePath("/admin/clients");
    redirect(`/admin/clients/${companyId}`);
  });
}

export async function setClientReadOnlyAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const companyId = str(data, "companyId");
    await setReadOnly(actor, {
      companyId,
      isReadOnly: bool(data, "isReadOnly"),
      reason: str(data, "reason"),
    });
    revalidatePath(`/admin/clients/${companyId}`);
    return { ok: true, message: "The company's read-only state has been changed." };
  });
}

// ── Access control on one client ────────────────────────────────────────────

export async function grantAccessAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const companyId = str(data, "companyId");

    // Addressed by email rather than by id: that is how support requests arrive,
    // and it keeps a user id — which is not a secret, but is not the operator's
    // to type either — out of the form.
    const email = normalizeEmail(str(data, "userEmail"));
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      return {
        error: `No account exists for ${email}. Create the user first, then grant them access.`,
      };
    }

    await grantMembership(actor, {
      companyId,
      userId: user.id,
      role: str(data, "role"),
      allowSeatOverage: false,
    });
    revalidatePath(`/admin/clients/${companyId}`);
    return { ok: true, message: `Access granted to ${email}.` };
  });
}

export async function changeRoleAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await changeMembershipRole(actor, {
      membershipId: str(data, "membershipId"),
      role: str(data, "role"),
    });
    revalidatePath(`/admin/clients/${str(data, "companyId")}`);
    return { ok: true, message: "Role changed." };
  });
}

export async function setAccessStatusAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const status = str(data, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await setMembershipStatus(actor, {
      membershipId: str(data, "membershipId"),
      status,
      reason: optionalStr(data, "reason") ?? null,
    });
    revalidatePath(`/admin/clients/${str(data, "companyId")}`);
    return { ok: true, message: status === "SUSPENDED" ? "Access suspended." : "Access reactivated." };
  });
}

export async function removeAccessAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await removeMembership(actor, {
      membershipId: str(data, "membershipId"),
      reason: str(data, "reason"),
    });
    revalidatePath(`/admin/clients/${str(data, "companyId")}`);
    return { ok: true, message: "Access removed." };
  });
}

// ── Subscription, from the client's own page ────────────────────────────────

export async function assignPlanFromClientAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const companyId = str(data, "companyId");
    await assignPlan(actor, {
      companyId,
      planCode: str(data, "planCode"),
      cycle: str(data, "billingCycle") || "MONTHLY",
      status: optionalStr(data, "status"),
      reason: optionalStr(data, "reason") ?? null,
    });
    revalidatePath(`/admin/clients/${companyId}`);
    revalidatePath("/admin/subscriptions");
    return { ok: true, message: "Plan assigned." };
  });
}

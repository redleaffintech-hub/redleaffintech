"use server";

import { revalidatePath } from "next/cache";
import { subscriptions as subscriptionsRepo } from "@/server/db/platform";
import {
  addNote,
  assignPlan,
  changeStatus,
  extendTrial,
  overrideSeats,
  setPeriodEnd,
  setProviderRef,
} from "@/server/admin/subscriptions";
import { bool, date, int, optionalStr, runAdminAction, str } from "@/server/admin/run-action";

/**
 * Subscription lifecycle actions.
 *
 * Each is a thin translation from form fields to a service call. The state
 * machine, the reason requirements and the seat-reduction refusal all live in
 * `src/server/admin/subscriptions.ts`, so the same rules apply however the
 * change arrives — from this console, from a script, or from a payment webhook
 * if one is ever wired in.
 */

async function refresh(subscriptionId: string) {
  const subscription = await subscriptionsRepo.get(subscriptionId);
  revalidatePath(`/admin/subscriptions/${subscriptionId}`);
  revalidatePath("/admin/subscriptions");
  revalidatePath("/admin");
  if (subscription) revalidatePath(`/admin/clients/${subscription.companyId}`);
}

export async function changeStatusAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    await changeStatus(actor, {
      subscriptionId,
      to: str(data, "status"),
      reason: optionalStr(data, "reason") ?? null,
      atPeriodEnd: bool(data, "atPeriodEnd"),
    });
    await refresh(subscriptionId);
    return { ok: true, message: "Status updated." };
  });
}

export async function changePlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    await assignPlan(actor, {
      companyId: str(data, "companyId"),
      planCode: str(data, "planCode"),
      cycle: str(data, "billingCycle") || "MONTHLY",
      status: optionalStr(data, "status"),
      reason: optionalStr(data, "reason") ?? null,
    });
    await refresh(subscriptionId);
    return { ok: true, message: "Plan updated. The new price has been snapshotted onto the subscription." };
  });
}

export async function extendTrialAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    const until = date(data, "until");
    const days = int(data, "days");

    await extendTrial(actor, {
      subscriptionId,
      days: until ? undefined : (days ?? undefined),
      until,
      reason: optionalStr(data, "reason") ?? null,
    });
    await refresh(subscriptionId);
    return { ok: true, message: "Trial extended." };
  });
}

export async function overrideSeatsAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    const seats = int(data, "seats");
    if (seats === null) return { error: "Enter a seat allowance." };

    await overrideSeats(actor, { subscriptionId, seats, reason: str(data, "reason") });
    await refresh(subscriptionId);
    return { ok: true, message: `Seat allowance set to ${seats}.` };
  });
}

export async function setPeriodEndAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    const currentPeriodEnd = date(data, "currentPeriodEnd");
    if (!currentPeriodEnd) return { error: "Choose a date." };

    await setPeriodEnd(actor, {
      subscriptionId,
      currentPeriodEnd,
      reason: optionalStr(data, "reason") ?? null,
    });
    await refresh(subscriptionId);
    return { ok: true, message: "Period end updated." };
  });
}

export async function addNoteAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    await addNote(actor, { subscriptionId, body: str(data, "body") });
    await refresh(subscriptionId);
    return { ok: true, message: "Note added." };
  });
}

export async function setProviderRefAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const subscriptionId = str(data, "subscriptionId");
    await setProviderRef(actor, { subscriptionId, providerRef: optionalStr(data, "providerRef") ?? null });
    await refresh(subscriptionId);
    return { ok: true, message: "Payment provider reference saved." };
  });
}

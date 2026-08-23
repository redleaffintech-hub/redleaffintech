"use server";

import { redirect } from "next/navigation";
import {
  archivePlan,
  createPlan,
  deletePlan,
  publishPlan,
  reactivatePlan,
  reorderPlans,
  setPlanVisibility,
  updatePlan,
  type PlanInput,
} from "@/server/plans/admin";
import { BILLING_CYCLES, MODULES } from "@/lib/plans";
import { bool, cents, int, optionalStr, runAdminAction, str } from "@/server/admin/run-action";

/**
 * Plan catalogue mutations.
 *
 * Editing and publishing are separate on purpose, and that separation is the
 * whole reason this section exists as more than a settings page: a price can be
 * revised over several saves, reviewed, and then released in one deliberate act.
 * Nothing an operator types here reaches a visitor until `publishPlanAction`
 * runs.
 */

function readPlanInput(data: FormData): PlanInput {
  const prices = Object.fromEntries(
    BILLING_CYCLES.map((cycle) => [
      cycle,
      {
        cycleAmountCents: cents(data, `price_${cycle}_cycle`) ?? 0,
        monthlyEquivalentCents: cents(data, `price_${cycle}_monthly`) ?? 0,
      },
    ]),
  ) as PlanInput["prices"];

  return {
    code: str(data, "code"),
    name: str(data, "name"),
    description: optionalStr(data, "description") ?? null,
    forWhom: optionalStr(data, "forWhom") ?? null,
    currency: str(data, "currency") || "CAD",
    seats: int(data, "seats", 1) ?? 1,
    companies: int(data, "companies", 1) ?? 1,
    storageGb: int(data, "storageGb", 1) ?? 1,
    support: str(data, "support"),
    modules: MODULES.filter((module) => data.getAll("modules").includes(module)),
    // One feature per line. Blank lines are dropped by `validate`.
    features: str(data, "features").split("\n").map((line) => line.trim()).filter(Boolean),
    isPopular: bool(data, "isPopular"),
    contactOnly: bool(data, "contactOnly"),
    isPublic: bool(data, "isPublic"),
    sortOrder: int(data, "sortOrder", 0) ?? 0,
    prices,
  };
}

export async function createPlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const plan = await createPlan(actor, readPlanInput(data));
    redirect(`/admin/plans/${plan.id}`);
  });
}

export async function updatePlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const planId = str(data, "planId");
    await updatePlan(actor, planId, readPlanInput(data));
    redirect(`/admin/plans/${planId}`);
  });
}

export async function publishPlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const version = await publishPlan(actor, str(data, "planId"));
    return {
      ok: true,
      message: `Published as version ${version.version}. The public pricing page now shows these figures.`,
    };
  });
}

export async function archivePlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await archivePlan(actor, str(data, "planId"), str(data, "reason"));
    return { ok: true, message: "Plan archived. Existing subscriptions keep their agreed terms." };
  });
}

export async function reactivatePlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await reactivatePlan(actor, str(data, "planId"));
    return { ok: true, message: "Plan reactivated." };
  });
}

export async function setVisibilityAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const isPublic = bool(data, "isPublic");
    await setPlanVisibility(actor, str(data, "planId"), isPublic);
    return {
      ok: true,
      message: isPublic
        ? "Shown on the public pricing page."
        : "Hidden from the public pricing page. It can still be assigned by hand.",
    };
  });
}

export async function reorderPlansAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const order = data
      .getAll("planId")
      .map((planId, index) => ({
        planId: String(planId),
        sortOrder: int(data, `sortOrder_${planId}`, (index + 1) * 10) ?? (index + 1) * 10,
      }));
    await reorderPlans(actor, order);
    return { ok: true, message: "Order saved." };
  });
}

export async function deletePlanAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await deletePlan(actor, str(data, "planId"));
    redirect("/admin/plans");
  });
}

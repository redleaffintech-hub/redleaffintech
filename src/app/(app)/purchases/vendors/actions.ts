"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createVendor, getVendor, listVendors, updateVendor } from "@/server/db/vendors";
import { getTaxCode } from "@/server/db/tax-codes";
import type { Vendor } from "@/server/db/types";

const provinceCodes = PROVINCES.map((p) => p.code);

/** Empty strings arrive from untouched inputs; store them as absent, not blank. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const optionalProvince = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine((value) => !value || provinceCodes.includes(value as (typeof provinceCodes)[number]), {
    message: "Choose a Canadian province or territory.",
  });

/**
 * Not exported, and neither is anything else here that is not an async function:
 * a "use server" module may only export those.
 */
const vendorSchema = z.object({
  name: z.string().trim().min(1, "A vendor needs a name."),
  email: z.union([z.literal(""), z.string().email("That email address is not valid.")]).optional(),
  phone: optionalText(40),
  businessNumber: optionalText(30),
  taxCodeId: optionalText(40),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),

  addressLine1: optionalText(120),
  city: optionalText(80),
  province: optionalProvince,
  postalCode: optionalText(12),

  notes: optionalText(2000),
});

/**
 * Create a vendor.
 *
 * Returns the created record in the shape the bill editor's party list wants,
 * so a vendor added mid-bill can be selected without a page reload.
 */
export async function createVendorAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the vendor details." };
  }

  const parsed = vendorSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the vendor details." };
  const input = parsed.data;

  // Names are how a user identifies a vendor in a dropdown; two identical ones
  // are almost always a duplicate rather than two real companies.
  const lower = input.name.toLowerCase();
  const clash = (await listVendors(company.id)).find((v) => v.name.toLowerCase() === lower);
  if (clash) return { error: `${clash.name} already exists as a vendor.` };

  if (input.taxCodeId && !(await getTaxCode(company.id, input.taxCodeId))) {
    return { error: "That tax code does not exist in this company." };
  }

  const vendor = await createVendor({
    companyId: company.id,
    name: input.name,
    email: input.email || null,
    phone: input.phone ?? null,
    businessNumber: input.businessNumber ?? null,
    taxCodeId: input.taxCodeId ?? null,
    paymentTermsDays: input.paymentTermsDays,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    postalCode: input.postalCode ?? null,
    notes: input.notes ?? null,
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "Vendor",
    entityId: vendor.id,
    summary: `Added vendor ${vendor.name}`,
  });

  revalidatePath("/purchases/vendors");
  revalidatePath("/purchases/bills/new");

  return { ok: true as const, vendor: toPartyOption(vendor) };
}

/**
 * Edit an existing vendor. Same validation and duplicate-name guard as create.
 */
export async function updateVendorAction(vendorId: string, payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);

  const existing = await getVendor(company.id, vendorId);
  if (!existing) return { error: "That vendor does not exist." };

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the vendor details." };
  }

  const parsed = vendorSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the vendor details." };
  const input = parsed.data;

  const lower = input.name.toLowerCase();
  const clash = (await listVendors(company.id)).find(
    (v) => v.id !== vendorId && v.name.toLowerCase() === lower,
  );
  if (clash) return { error: `${clash.name} already exists as a vendor.` };

  if (input.taxCodeId && !(await getTaxCode(company.id, input.taxCodeId))) {
    return { error: "That tax code does not exist in this company." };
  }

  const patch = {
    name: input.name,
    email: input.email || null,
    phone: input.phone ?? null,
    businessNumber: input.businessNumber ?? null,
    taxCodeId: input.taxCodeId ?? null,
    paymentTermsDays: input.paymentTermsDays,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    postalCode: input.postalCode ?? null,
    notes: input.notes ?? null,
  };
  await updateVendor(company.id, vendorId, patch);
  const vendor: Vendor = { ...existing, ...patch };

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Vendor",
    entityId: vendor.id,
    summary: `Updated vendor ${vendor.name}`,
  });

  revalidatePath("/purchases/vendors");
  revalidatePath(`/purchases/vendors/${vendor.id}`);
  revalidatePath(`/purchases/vendors/${vendor.id}/edit`);
  revalidatePath("/purchases/bills/new");

  return { ok: true as const, vendor: toPartyOption(vendor) };
}

/**
 * The shape `DocumentForm` needs to select a party on a bill. Not exported: a
 * "use server" module may only export async functions.
 */
function toPartyOption(vendor: Vendor) {
  return {
    id: vendor.id,
    name: vendor.name,
    taxCodeId: vendor.taxCodeId,
    paymentTermsDays: vendor.paymentTermsDays,
  };
}

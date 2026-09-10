"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "@/server/db/customers";
import { getTaxCode } from "@/server/db/tax-codes";
import type { Customer } from "@/server/db/types";

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
 * a "use server" module may only export those. Exporting the schema fails at
 * render time with "found object", which `next build` does not catch.
 */
const customerSchema = z.object({
  name: z.string().trim().min(1, "A customer needs a name."),
  email: z.union([z.literal(""), z.string().email("That email address is not valid.")]).optional(),
  phone: optionalText(40),
  taxCodeId: optionalText(40),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(15),

  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  province: optionalProvince,
  postalCode: optionalText(12),

  /**
   * A ship-to that is left entirely blank means "same as billing" and is stored
   * as null rather than as a copy — so correcting the billing address does not
   * leave a stale duplicate behind as the shipping one.
   */
  shipToLine1: optionalText(120),
  shipToLine2: optionalText(120),
  shipToCity: optionalText(80),
  shipToProvince: optionalProvince,
  shipToPostalCode: optionalText(12),

  notes: optionalText(2000),
});

/**
 * Create a customer.
 *
 * Returns the created record in the shape the invoice editor's party list wants,
 * so a customer added mid-invoice can be selected without a page reload.
 */
export async function createCustomerAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the customer details." };
  }

  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the customer details." };
  const input = parsed.data;

  // Names are how a user identifies a customer in a dropdown; two identical ones
  // are almost always a duplicate rather than two real companies.
  const lower = input.name.toLowerCase();
  const clash = (await listCustomers(company.id)).find((c) => c.name.toLowerCase() === lower);
  if (clash) return { error: `${clash.name} already exists as a customer.` };

  if (input.taxCodeId && !(await getTaxCode(company.id, input.taxCodeId))) {
    return { error: "That tax code does not exist in this company." };
  }

  const customer = await createCustomer({
    companyId: company.id,
    name: input.name,
    email: input.email || null,
    phone: input.phone ?? null,
    taxCodeId: input.taxCodeId ?? null,
    paymentTermsDays: input.paymentTermsDays,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    postalCode: input.postalCode ?? null,
    shipToLine1: input.shipToLine1 ?? null,
    shipToLine2: input.shipToLine2 ?? null,
    shipToCity: input.shipToCity ?? null,
    shipToProvince: input.shipToProvince ?? null,
    shipToPostalCode: input.shipToPostalCode ?? null,
    notes: input.notes ?? null,
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "Customer",
    entityId: customer.id,
    summary: `Added customer ${customer.name}`,
  });

  revalidatePath("/sales/customers");
  revalidatePath("/sales/invoices/new");

  return { ok: true as const, customer: toPartyOption(customer) };
}

/**
 * Edit an existing customer.
 *
 * Same validation and shape as `createCustomerAction`. Addresses already
 * snapshotted onto issued invoices are not touched — those are a record of what
 * was sent. Only new documents pick up the change.
 */
export async function updateCustomerAction(customerId: string, payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);

  const existing = await getCustomer(company.id, customerId);
  if (!existing) return { error: "That customer does not exist." };

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the customer details." };
  }

  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the customer details." };
  const input = parsed.data;

  const lower = input.name.toLowerCase();
  const clash = (await listCustomers(company.id)).find(
    (c) => c.id !== customerId && c.name.toLowerCase() === lower,
  );
  if (clash) return { error: `${clash.name} already exists as a customer.` };

  if (input.taxCodeId && !(await getTaxCode(company.id, input.taxCodeId))) {
    return { error: "That tax code does not exist in this company." };
  }

  const patch = {
    name: input.name,
    email: input.email || null,
    phone: input.phone ?? null,
    taxCodeId: input.taxCodeId ?? null,
    paymentTermsDays: input.paymentTermsDays,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    postalCode: input.postalCode ?? null,
    shipToLine1: input.shipToLine1 ?? null,
    shipToLine2: input.shipToLine2 ?? null,
    shipToCity: input.shipToCity ?? null,
    shipToProvince: input.shipToProvince ?? null,
    shipToPostalCode: input.shipToPostalCode ?? null,
    notes: input.notes ?? null,
  };
  await updateCustomer(company.id, customerId, patch);
  const customer: Customer = { ...existing, ...patch };

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Customer",
    entityId: customer.id,
    summary: `Updated customer ${customer.name}`,
  });

  revalidatePath("/sales/customers");
  revalidatePath(`/sales/customers/${customer.id}`);
  revalidatePath(`/sales/customers/${customer.id}/edit`);
  revalidatePath("/sales/invoices/new");

  return { ok: true as const, customer: toPartyOption(customer) };
}

/**
 * The shape `DocumentForm` needs to select a party and seed its addresses.
 * Not exported: a "use server" module may only export async functions.
 */
function toPartyOption(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    taxCodeId: customer.taxCodeId,
    paymentTermsDays: customer.paymentTermsDays,
    billTo: {
      line1: customer.addressLine1,
      line2: customer.addressLine2,
      city: customer.city,
      province: customer.province,
      postalCode: customer.postalCode,
      country: customer.country,
    },
    shipTo: customer.shipToLine1 || customer.shipToCity || customer.shipToProvince
      ? {
          line1: customer.shipToLine1,
          line2: customer.shipToLine2,
          city: customer.shipToCity,
          province: customer.shipToProvince,
          postalCode: customer.shipToPostalCode,
          country: customer.shipToCountry ?? customer.country,
        }
      : null,
  };
}

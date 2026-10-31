import "server-only";
import { db } from "@/lib/db";
import { MAX_ACCOUNTS_PER_COMPANY } from "@/lib/coa-limit";

export interface NewAccountData {
  code: string;
  name: string;
  type: string;
  subtype: string;
  description: string | null;
  isActive: boolean;
}

/**
 * Add an account, refusing once the company already holds the maximum. Returns
 * null when full. Count and insert run under a lock on the company row, so two
 * simultaneous adds at 499 cannot both succeed.
 */
export async function createAccountWithinLimit(companyId: string, data: NewAccountData) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
    const total = await tx.account.count({ where: { companyId } });
    if (total >= MAX_ACCOUNTS_PER_COMPANY) return null;
    return tx.account.create({ data: { companyId, ...data } });
  });
}

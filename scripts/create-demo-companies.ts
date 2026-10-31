/**
 * Provision four demo client companies, each with its own login, differing only
 * in which modules are switched on. Idempotent on the login email: a company
 * whose demo user already exists is skipped.
 *
 *   DATABASE_URL=<target> npx tsx scripts/create-demo-companies.ts
 */
import "./load-env";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { createClient } from "../src/server/admin/clients";
import { hashPassword } from "../src/server/auth/password";

const DEMOS = [
  { label: "Regular", modules: ["ACCOUNTING", "PAYMENTS"] },
  { label: "Regular + Payroll", modules: ["ACCOUNTING", "PAYMENTS", "HR", "PAYROLL"] },
  { label: "Regular + Payroll + Inventory", modules: ["ACCOUNTING", "PAYMENTS", "HR", "PAYROLL", "INVENTORY"] },
  { label: "Regular + Inventory", modules: ["ACCOUNTING", "PAYMENTS", "INVENTORY"] },
];
const EMAILS = ["demo1@redleaffintech.com", "demo2@redleaffintech.com", "demo3@redleaffintech.com", "demo4@redleaffintech.com"];

function password() {
  const a = "abcdefghjkmnpqrstuvwxyz", A = "ABCDEFGHJKLMNPQRSTUVWXYZ", d = "23456789";
  const pick = (s: string, n: number) => Array.from(randomBytes(n), (b) => s[b % s.length]).join("");
  return `${pick(A, 2)}${pick(a, 4)}-${pick(d, 4)}${pick(a, 2)}!`;
}

async function main() {
  const admin = await db.user.findFirst({ where: { isPlatformAdmin: true, platformAdminSuspendedAt: null } });
  if (!admin) throw new Error("No active platform admin to attribute the audit trail to.");
  const actor = { id: admin.id, name: admin.name, email: admin.email, mfaEnabled: false, mustChangePassword: false, sessionToken: "" } as never;

  for (let i = 0; i < DEMOS.length; i++) {
    const demo = DEMOS[i];
    const email = EMAILS[i];
    if (await db.user.findUnique({ where: { email } })) {
      console.log(`SKIP  ${demo.label}: ${email} already exists`);
      continue;
    }
    const res = await createClient(actor, {
      name: `Demo - ${demo.label}`,
      province: "ON",
      industry: "Demo",
      primaryUserName: `Demo ${i + 1}`,
      primaryUserEmail: email,
      planCode: "BASIC",
      billingCycle: "MONTHLY",
      trialDays: 90,
      enabledModules: demo.modules,
    });
    const pw = password();
    await db.user.update({ where: { id: res.userId }, data: { passwordHash: await hashPassword(pw), mustChangePassword: false, passwordChangedAt: new Date() } });
    console.log(`OK    ${demo.label}\n      company=${res.companyId}\n      login=${email}\n      password=${pw}\n      modules=${demo.modules.join(",")}`);
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Checks for field-level encryption (src/server/security). Nothing persists: the
 * database part runs in a transaction that is rolled back.
 *
 * `npm run verify:encryption`
 */
import "./load-env";
import { randomBytes } from "node:crypto";

if (!process.env.DATA_ENCRYPTION_KEYS) process.env.DATA_ENCRYPTION_KEYS = "1:" + randomBytes(32).toString("base64");

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createEncryptionHandler, type DataModel } from "../src/server/security/encrypted-db";
import { decryptField, encryptField, isEncrypted } from "../src/server/security/field-crypto";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function throws(fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  // ── primitive ──────────────────────────────────────────────────────────
  const ct = encryptField("jane@acme.ca", "cmpA", "Customer.email");
  check("ciphertext is marked and hides the value", isEncrypted(ct) && !ct.includes("jane"));
  check("round-trips", decryptField(ct, "Customer.email") === "jane@acme.ca");
  check("same plaintext encrypts differently each time", encryptField("x", "cmpA", "Customer.email") !== encryptField("x", "cmpA", "Customer.email"));
  check("plaintext passes through decrypt", decryptField("plain", "Customer.email") === "plain");
  check("moving a value to another column fails", await throws(() => decryptField(ct, "Customer.phone")));
  const swapped = ct.replace(":cmpA:", ":cmpB:");
  check("moving a value to another company fails", await throws(() => decryptField(swapped, "Customer.email")));
  check("a flipped bit is rejected", await throws(() => decryptField(ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA"), "Customer.email")));
  check("unicode survives", decryptField(encryptField("नमस्ते Zoë 😀", "cmpA", "Customer.notes"), "Customer.notes") === "नमस्ते Zoë 😀");

  // ── handler against a stub query ───────────────────────────────────────
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://u:p@localhost:1/x" }) });
  const dm = (raw as unknown as { _runtimeDataModel: DataModel })._runtimeDataModel;
  const lookups: unknown[] = [];
  const fakeBase = {
    customer: { findFirst: async (a: unknown) => (lookups.push(a), { companyId: "cmpA" }) },
    vendor: { findFirst: async () => ({ companyId: "cmpA" }) },
    Customer: { findFirst: async (a: unknown) => (lookups.push(a), { companyId: "cmpA" }) },
    Contact: { findFirst: async () => ({ customer: { companyId: "cmpA" }, vendor: null }) },
  };
  const handler = createEncryptionHandler(dm, fakeBase);
  let seen: any;
  const run = (model: string, operation: string, args: any, result: any = {}) =>
    handler({ model, operation, args, query: async (a) => ((seen = a), result) });

  await run("Customer", "create", {
    data: { companyId: "cmpA", name: "Acme", email: "a@acme.ca", phone: "555", contacts: { create: [{ name: "Bo", email: "bo@acme.ca" }] } },
  });
  check("create: encrypts own columns", isEncrypted(seen.data.email) && isEncrypted(seen.data.phone));
  check("create: leaves name readable", seen.data.name === "Acme");
  check("create: encrypts nested contact", isEncrypted(seen.data.contacts.create[0].email) && seen.data.contacts.create[0].name === "Bo");
  check("create: needs no DB lookup when companyId is present", lookups.length === 0);

  await run("Customer", "update", { where: { id: "c1" }, data: { email: { set: "n@acme.ca" }, name: "Acme 2" } });
  check("update: encrypts {set} form via a scope lookup", isEncrypted(seen.data.email.set) && lookups.length === 1);
  lookups.length = 0;
  await run("Customer", "update", { where: { id: "c1" }, data: { name: "Only name" } });
  check("update: no lookup when no encrypted column is touched", lookups.length === 0 && seen.data.name === "Only name");

  await run("Contact", "create", { data: { customerId: "c1", name: "Z", phone: "1" } });
  check("contact: scope comes from its parent customer", isEncrypted(seen.data.phone));

  const company = await run("Company", "create", { data: { name: "Co", gstNumber: "123456789RT0001" } });
  void company;
  check("company: gets its own id and encrypts with it", typeof seen.data.id === "string" && isEncrypted(seen.data.gstNumber) && seen.data.gstNumber.includes(`:${seen.data.id}:`));

  await run("Invoice", "update", { where: { id: "i1", companyId: "cmpA" }, data: { billToLine1: "1 Main St" } });
  check("invoice: snapshot address encrypted, scope read from where", isEncrypted(seen.data.billToLine1));

  const stored = {
    id: "c1", name: "Acme", email: encryptField("a@acme.ca", "cmpA", "Customer.email"),
    invoices: [{ id: "i1", billToLine1: encryptField("1 Main", "cmpA", "Invoice.billToLine1") }],
  };
  const out: any = await handler({ model: "Customer", operation: "findFirst", args: {}, query: async () => stored });
  check("read: decrypts own and nested columns", out.email === "a@acme.ca" && out.invoices[0].billToLine1 === "1 Main");
  const viaInclude: any = await handler({
    model: "Payment", operation: "findMany", args: {},
    query: async () => [{ id: "p1", customer: { id: "c1", email: encryptField("q@x.ca", "cmpA", "Customer.email") } }],
  });
  check("read: decrypts a relation reached from another model", viaInclude[0].customer.email === "q@x.ca");

  check("guard: where on an encrypted column throws", await throws(() => run("Customer", "findMany", { where: { email: { contains: "a" } } })));
  check("guard: nested/OR where throws", await throws(() => run("Customer", "findMany", { where: { OR: [{ name: "x" }, { phone: "1" }] } })));
  check("guard: relation filter throws", await throws(() => run("Invoice", "findMany", { where: { customer: { is: { email: "a" } } } })));
  check("guard: orderBy throws", await throws(() => run("Customer", "findMany", { orderBy: { city: "asc" } })));
  check("guard: null-ness filter is allowed", !(await throws(() => run("Customer", "findMany", { where: { email: { not: null } } }))));
  check("guard: plaintext columns unaffected", !(await throws(() => run("Customer", "findMany", { where: { name: { contains: "a" } }, orderBy: { name: "asc" } }))));
  await raw.$disconnect();

  // ── real database, rolled back ─────────────────────────────────────────
  const { db } = await import("../src/lib/db");
  const ROLLBACK = "rollback-probe";
  try {
    await db.$transaction(async (tx) => {
      const co = await tx.company.create({ data: { name: "ZZ Encryption Probe", email: "owner@probe.ca", gstNumber: "999999999RT0001" } });
      check("db: company read-back is decrypted", co.email === "owner@probe.ca" && co.gstNumber === "999999999RT0001");
      const cust = await tx.customer.create({
        data: { companyId: co.id, name: "Probe Cust", email: "c@probe.ca", phone: "604-555-0100", addressLine1: "1 Probe Way", contacts: { create: [{ name: "P", email: "p@probe.ca" }] } },
        include: { contacts: true },
      });
      check("db: customer + nested contact decrypted on create", cust.email === "c@probe.ca" && cust.contacts[0].email === "p@probe.ca");
      const stored = await tx.$queryRaw<{ email: string; phone: string; addressLine1: string }[]>`SELECT email, phone, "addressLine1" FROM "Customer" WHERE id = ${cust.id}`;
      check("db: stored bytes are ciphertext, not plaintext", isEncrypted(stored[0].email) && isEncrypted(stored[0].phone) && isEncrypted(stored[0].addressLine1) && !JSON.stringify(stored[0]).includes("probe.ca"));
      const storedContact = await tx.$queryRaw<{ email: string }[]>`SELECT email FROM "Contact" WHERE "customerId" = ${cust.id}`;
      check("db: nested contact stored as ciphertext", isEncrypted(storedContact[0].email));
      // A scope lookup runs outside the transaction, so it cannot see a row this same
      // transaction just created. That must fail loudly, never write plaintext.
      const blind = await throws(() => tx.customer.update({ where: { id: cust.id }, data: { email: "x@probe.ca" } }));
      check("db: unscoped update of an uncommitted row fails loudly", blind);
      const upd = await tx.customer.update({ where: { id: cust.id, companyId: co.id }, data: { email: "new@probe.ca", notes: "x" } });
      check("db: scoped update round-trips", upd.email === "new@probe.ca" && upd.notes === "x");
      const found = await tx.customer.findMany({ where: { companyId: co.id, name: { contains: "probe", mode: "insensitive" } }, include: { contacts: true } });
      check("db: findMany with include decrypts", found[0]?.email === "new@probe.ca" && found[0]?.contacts[0]?.email === "p@probe.ca");
      const inv = await tx.customer.findUnique({ where: { id: cust.id }, select: { company: { select: { email: true } } } });
      check("db: nested select through a relation decrypts", inv?.company.email === "owner@probe.ca");
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e;
  }
  const leftover = await db.company.count({ where: { name: "ZZ Encryption Probe" } });
  check("db: probe rolled back, nothing persisted", leftover === 0);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll encryption checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

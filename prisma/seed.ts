/**
 * Demo data.
 *
 * Everything here is created by calling the real services — provisionCompany,
 * createInvoice, postBill, recordPayment, categorizeTransaction — so the seeded
 * books are genuinely double-entry consistent. If a posting rule is wrong, this
 * script fails or the trial balance stops balancing; nothing is faked.
 */

import "../scripts/load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { hashPassword } from "../src/server/auth/password";
import { provisionCompany } from "../src/server/setup/provision";
import { postJournal } from "../src/server/accounting/ledger";
import { createInvoice } from "../src/server/documents/invoices";
import { createBill } from "../src/server/documents/bills";
import { createExpense } from "../src/server/documents/expenses";
import { recordPayment } from "../src/server/documents/payments";
import { createCreditNote } from "../src/server/documents/credit-notes";
import { checkLedgerIntegrity } from "../src/server/accounting/ledger";
import { addDays, utcDate, toUtcDay } from "../src/lib/dates";
import { normalizeDescription } from "../src/server/banking/import";

/** Deterministic PRNG so re-seeding produces the same books. */
let seedState = 0x2f6e2b1;
function rand(): number {
  seedState ^= seedState << 13; seedState ^= seedState >>> 17; seedState ^= seedState << 5;
  return ((seedState >>> 0) % 100000) / 100000;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}
function between(min: number, max: number): number {
  return Math.round(min + rand() * (max - min));
}

const TODAY = toUtcDay(new Date());
const YEAR = TODAY.getUTCFullYear();
const CURRENT_MONTH = TODAY.getUTCMonth() + 1;

async function main() {
  console.log("Resetting database…");
  await resetDatabase();

  const password = await hashPassword("demo1234");

  const firm = await db.firm.create({
    data: { name: "Cedar & Vale CPA Professional Corporation", email: "clients@cedarvale.ca", phone: "(416) 555-0180" },
  });

  const owner = await db.user.create({
    data: { email: "owner@northbridge.ca", name: "Priya Raman", passwordHash: password },
  });
  const bookkeeper = await db.user.create({
    data: { email: "books@northbridge.ca", name: "Daniel Okafor", passwordHash: password },
  });
  const reviewer = await db.user.create({
    data: { email: "review@northbridge.ca", name: "Marie-Claude Tremblay", passwordHash: password },
  });
  const accountant = await db.user.create({
    data: { email: "accountant@cedarvale.ca", name: "Jonathan Vale, CPA", passwordHash: password },
  });
  await db.firmUser.createMany({
    data: [{ firmId: firm.id, userId: accountant.id, role: "FIRM_ADMIN" }],
  });

  // ── Company 1: the fully worked example ──────────────────────────────────
  console.log("Provisioning Northbridge Consulting Inc. (Ontario)…");
  const northbridge = await db.$transaction(
    (tx) =>
      provisionCompany(tx, {
        name: "Northbridge Consulting Inc.",
        legalName: "Northbridge Consulting Incorporated",
        province: "ON",
        fiscalYearStartMonth: 1,
        businessNumber: "80122 4471 RC0001",
        gstNumber: "80122 4471 RT0001",
        email: "accounts@northbridge.ca",
        phone: "(416) 555-0142",
        addressLine1: "18 Wellington Street West, Suite 1400",
        city: "Toronto",
        postalCode: "M5L 1G4",
        industry: "Management consulting",
        firmId: firm.id,
        fiscalYears: [YEAR - 1, YEAR, YEAR + 1],
      }),
    { timeout: 60_000 },
  );

  await db.companyUser.createMany({
    data: [
      { companyId: northbridge.id, userId: owner.id, role: "PRIMARY", acceptedAt: new Date() },
      { companyId: northbridge.id, userId: bookkeeper.id, role: "SECONDARY", acceptedAt: new Date() },
      { companyId: northbridge.id, userId: reviewer.id, role: "REVIEWER", acceptedAt: new Date() },
      { companyId: northbridge.id, userId: accountant.id, role: "ACCOUNTANT", acceptedAt: new Date() },
    ],
  });
  await db.user.update({ where: { id: owner.id }, data: { activeCompanyId: northbridge.id } });
  await db.user.update({ where: { id: accountant.id }, data: { activeCompanyId: northbridge.id } });

  await buildBooks(northbridge.id, owner.id);

  // ── Company 2: a second client for the firm workspace ────────────────────
  console.log("Provisioning Pacific Harbour Studio Ltd. (British Columbia)…");
  const pacific = await db.$transaction(
    (tx) =>
      provisionCompany(tx, {
        name: "Pacific Harbour Studio Ltd.",
        province: "BC",
        fiscalYearStartMonth: 1,
        email: "hello@pacificharbour.ca",
        city: "Vancouver",
        addressLine1: "290 Alexander Street",
        postalCode: "V6A 1C1",
        industry: "Design studio",
        firmId: firm.id,
        fiscalYears: [YEAR - 1, YEAR, YEAR + 1],
      }),
    { timeout: 60_000 },
  );
  await db.companyUser.createMany({
    data: [
      { companyId: pacific.id, userId: owner.id, role: "PRIMARY", acceptedAt: new Date() },
      { companyId: pacific.id, userId: accountant.id, role: "ACCOUNTANT", acceptedAt: new Date() },
    ],
  });
  await buildSmallBooks(pacific.id, owner.id);

  // ── Verify what we produced actually balances ─────────────────────────────
  for (const company of [northbridge, pacific]) {
    const integrity = await checkLedgerIntegrity(db, company.id);
    console.log(
      `  ${company.name}: debits ${(integrity.debits / 100).toFixed(2)} / credits ${(integrity.credits / 100).toFixed(2)} — ` +
        `${integrity.balanced ? "BALANCED" : "OUT OF BALANCE"}, accounting equation gap ${(integrity.equationGapCents / 100).toFixed(2)}`,
    );
    if (!integrity.balanced || integrity.equationGapCents !== 0) {
      throw new Error(`Seeded books for ${company.name} do not balance.`);
    }
  }

  console.log("\nSign in with any of:");
  console.log("  owner@northbridge.ca       / demo1234   (Primary admin)");
  console.log("  books@northbridge.ca       / demo1234   (Bookkeeper)");
  console.log("  review@northbridge.ca      / demo1234   (Reviewer)");
  console.log("  accountant@cedarvale.ca    / demo1234   (External accountant, 2 clients)");
}

async function resetDatabase() {
  // Order matters: children before parents.
  //
  // This is an interactive transaction rather than the batched array form
  // because the array form takes no timeout option: 43 statements is well
  // under a second against localhost but 7.2 s against a remote Neon region,
  // and Prisma's interactive default is 5 s.
  await db.$transaction(async (tx) => {
    await tx.taxEntry.deleteMany(); await tx.paymentAllocation.deleteMany(); await tx.payment.deleteMany();
    await tx.invoiceLine.deleteMany(); await tx.invoice.deleteMany();
    await tx.estimateLine.deleteMany(); await tx.estimate.deleteMany();
    await tx.creditNoteLine.deleteMany(); await tx.creditNote.deleteMany();
    await tx.billLine.deleteMany(); await tx.bill.deleteMany();
    await tx.expenseLine.deleteMany(); await tx.expense.deleteMany();
    await tx.bankTransaction.deleteMany(); await tx.bankReconciliation.deleteMany();
    await tx.bankRule.deleteMany(); await tx.bankAccount.deleteMany();
    await tx.journalLine.deleteMany(); await tx.journalEntry.deleteMany();
    await tx.budgetLine.deleteMany(); await tx.budget.deleteMany();
    await tx.notification.deleteMany(); await tx.attachment.deleteMany(); await tx.auditLog.deleteMany();
    await tx.recurringTemplate.deleteMany(); await tx.project.deleteMany();
    await tx.serviceItem.deleteMany(); await tx.contact.deleteMany();
    await tx.customer.deleteMany(); await tx.vendor.deleteMany();
    await tx.taxComponent.deleteMany(); await tx.taxCode.deleteMany(); await tx.taxPeriod.deleteMany();
    await tx.fiscalPeriod.deleteMany(); await tx.account.deleteMany();
    await tx.subscription.deleteMany(); await tx.companyUser.deleteMany();
    await tx.session.deleteMany(); await tx.firmUser.deleteMany();
    await tx.company.deleteMany(); await tx.firm.deleteMany(); await tx.user.deleteMany();
  }, { timeout: 120_000, maxWait: 30_000 });
}

async function accountsOf(companyId: string) {
  const accounts = await db.account.findMany({ where: { companyId } });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const bySystem = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  return { byCode, bySystem, all: accounts };
}

// ─────────────────────────────────────────────────────────────────────────────

async function buildBooks(companyId: string, userId: string) {
  const { byCode } = await accountsOf(companyId);
  const code = (c: string) => byCode.get(c)!.id;

  const taxCodes = await db.taxCode.findMany({ where: { companyId } });
  const hst = taxCodes.find((t) => t.code === "HST-ON")!;
  const gstOnly = taxCodes.find((t) => t.code === "GST")!;
  const zero = taxCodes.find((t) => t.code === "ZERO")!;
  const outOfScope = taxCodes.find((t) => t.code === "OUT")!;

  // Opening balances at the start of the current fiscal year.
  console.log("  posting opening balances…");
  await db.$transaction((tx) =>
    postJournal(tx, {
      companyId,
      date: utcDate(YEAR - 1, 12, 31),
      memo: "Opening balances brought forward",
      sourceType: "OPENING",
      createdById: userId,
      lines: [
        { accountId: code("1000"), debitCents: 8_420_000, description: "Business chequing" },
        { accountId: code("1010"), debitCents: 3_500_000, description: "Business savings" },
        { accountId: code("1500"), debitCents: 1_845_000, description: "Computer equipment" },
        { accountId: code("1510"), debitCents: 962_000, description: "Office furniture" },
        { accountId: code("1590"), creditCents: 741_000, description: "Accumulated depreciation" },
        { accountId: code("2100"), creditCents: 312_000, description: "Corporate credit card" },
        { accountId: code("3000"), creditCents: 1_000_000, description: "Common shares" },
        { accountId: code("3300"), creditCents: 12_674_000, description: "Retained earnings" },
      ],
    }),
  );

  // ── Master data ──────────────────────────────────────────────────────────
  console.log("  creating customers, vendors and services…");
  const customerSeed = [
    ["Halcyon Systems Inc.", "ap@halcyonsystems.ca", "Toronto", "ON", 30],
    ["Brightline Logistics", "finance@brightline.ca", "Mississauga", "ON", 30],
    ["Kettle Creek Brewing Co.", "accounts@kettlecreek.ca", "London", "ON", 15],
    ["Meridian Health Group", "payables@meridianhealth.ca", "Ottawa", "ON", 45],
    ["Aurora Fintech Labs", "billing@aurorafintech.ca", "Toronto", "ON", 15],
    ["Northwind Property Trust", "ap@northwindtrust.ca", "Hamilton", "ON", 30],
    ["Lakeshore Municipal Authority", "invoices@lakeshore.on.ca", "Burlington", "ON", 60],
    ["Cascadia Renewables Ltd.", "ap@cascadiarenew.ca", "Vancouver", "BC", 30],
    ["Sable Island Media", "hello@sableisland.ca", "Halifax", "NS", 15],
  ] as const;

  const customers: Awaited<ReturnType<typeof db.customer.create>>[] = [];
  for (const [name, email, city, province, terms] of customerSeed) {
    customers.push(
      await db.customer.create({
        data: {
          companyId, name, email, city, province,
          paymentTermsDays: terms,
          taxCodeId: province === "ON" ? hst.id : gstOnly.id,
          phone: `(${between(204, 905)}) 555-0${between(100, 199)}`,
          addressLine1: `${between(10, 900)} ${pick(["King", "Queen", "Bay", "Front", "Dundas", "College"])} Street ${pick(["West", "East"])}`,
          postalCode: `${pick(["M5V", "L5B", "N6A", "K1P", "L8P", "V6B"])} ${between(1, 9)}${pick(["A", "B", "C", "K"])}${between(1, 9)}`,
        },
      }),
    );
  }

  const vendorSeed = [
    ["Regus Office Solutions", "6080", "Rent", hst.id],
    ["Bell Business", "6120", "Telephone & internet", hst.id],
    ["Atlas Cloud Services", "6030", "Software & subscriptions", hst.id],
    ["Verity Legal LLP", "6070", "Professional fees", hst.id],
    ["Cedar & Vale CPA", "6070", "Accounting fees", hst.id],
    ["Sundara Contracting", "5000", "Subcontractor", hst.id],
    ["Beaumont Insurance Brokers", "6040", "Insurance", zero.id],
    ["Quill & Press Supplies", "6060", "Office supplies", hst.id],
    ["Wavelength Digital Media", "6000", "Advertising", hst.id],
    ["Meridian Travel Group", "6130", "Travel", hst.id],
  ] as const;

  const vendors = [];
  for (const [name, expenseCode, note, taxCodeId] of vendorSeed) {
    vendors.push({
      record: await db.vendor.create({
        data: {
          companyId, name, notes: note, taxCodeId,
          email: `ap@${name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)}.ca`,
          paymentTermsDays: pick([15, 30, 30, 45]),
          city: pick(["Toronto", "Mississauga", "Ottawa", "Markham"]),
          province: "ON",
        },
      }),
      expenseAccountId: code(expenseCode),
      taxCodeId,
    });
  }

  const items = await Promise.all(
    [
      ["STRAT", "Strategy engagement", 27_500, "4000", "day"],
      ["ADVIS", "Advisory retainer", 850_000, "4020", "month"],
      ["IMPL", "Implementation services", 19_500, "4010", "hour"],
      ["WKSHP", "Facilitated workshop", 450_000, "4000", "session"],
      ["AUDIT", "Process review", 22_000, "4010", "hour"],
    ].map(([itemCode, name, price, account, unit]) =>
      db.serviceItem.create({
        data: {
          companyId,
          code: itemCode as string,
          name: name as string,
          unitPriceCents: price as number,
          unit: unit as string,
          incomeAccountId: code(account as string),
          taxCodeId: hst.id,
        },
      }),
    ),
  );

  const projects = await Promise.all([
    db.project.create({ data: { companyId, code: "HAL-ERP", name: "Halcyon ERP selection", customerId: customers[0].id, budgetCents: 12_000_000, startDate: utcDate(YEAR, 2, 1) } }),
    db.project.create({ data: { companyId, code: "MER-TRN", name: "Meridian clinical transformation", customerId: customers[3].id, budgetCents: 24_000_000, startDate: utcDate(YEAR, 3, 15) } }),
  ]);

  // ── Bank accounts ────────────────────────────────────────────────────────
  const chequing = await db.bankAccount.create({
    data: {
      companyId, accountId: code("1000"), name: "RBC Business Chequing",
      institution: "Royal Bank of Canada", accountNumberMasked: "••••4417", type: "BANK",
      openingBalanceCents: 8_420_000, openingDate: utcDate(YEAR - 1, 12, 31), feedStatus: "CONNECTED", feedProvider: "demo-feed",
    },
  });
  const savings = await db.bankAccount.create({
    data: {
      companyId, accountId: code("1010"), name: "RBC Business Savings",
      institution: "Royal Bank of Canada", accountNumberMasked: "••••9902", type: "BANK",
      openingBalanceCents: 3_500_000, openingDate: utcDate(YEAR - 1, 12, 31), feedStatus: "CONNECTED", feedProvider: "demo-feed",
    },
  });
  const visa = await db.bankAccount.create({
    data: {
      companyId, accountId: code("2100"), name: "Corporate Visa",
      institution: "Royal Bank of Canada", accountNumberMasked: "••••3081", type: "CREDIT_CARD",
      openingBalanceCents: -312_000, openingDate: utcDate(YEAR - 1, 12, 31), feedStatus: "CONNECTED", feedProvider: "demo-feed",
    },
  });

  await db.bankRule.createMany({
    data: [
      { companyId, name: "Atlas Cloud → Software", matchValue: "ATLAS CLOUD", direction: "OUT", setAccountId: code("6030"), setTaxCodeId: hst.id, setVendorId: vendors[2].record.id, autoConfirm: true, priority: 10 },
      { companyId, name: "Bell → Telephone & internet", matchValue: "BELL BUSINESS", direction: "OUT", setAccountId: code("6120"), setTaxCodeId: hst.id, setVendorId: vendors[1].record.id, autoConfirm: true, priority: 20 },
      { companyId, name: "Regus → Rent", matchValue: "REGUS", direction: "OUT", setAccountId: code("6080"), setTaxCodeId: hst.id, setVendorId: vendors[0].record.id, autoConfirm: false, priority: 30 },
      { companyId, name: "Bank fees", matchValue: "SERVICE CHARGE", direction: "OUT", setAccountId: code("6010"), setTaxCodeId: outOfScope.id, autoConfirm: true, priority: 40 },
      { companyId, name: "Interac fees", matchValue: "INTERAC FEE", direction: "OUT", setAccountId: code("6010"), setTaxCodeId: outOfScope.id, autoConfirm: true, priority: 50 },
    ],
  });

  // ── Transactions, month by month ─────────────────────────────────────────
  console.log("  posting invoices, bills, expenses and payments…");
  const bankLines: { bankAccountId: string; date: Date; description: string; amountCents: number; journalEntryId?: string | null; status: string; categoryAccountId?: string | null; matchedType?: string; matchedId?: string }[] = [];

  const monthsToBuild = CURRENT_MONTH;
  const postedInvoices: { id: string; customerId: string; totalCents: number; issueDate: Date; number: string }[] = [];

  for (let month = 1; month <= monthsToBuild; month++) {
    const invoiceCount = between(4, 7);
    for (let i = 0; i < invoiceCount; i++) {
      const customer = pick(customers);
      const day = Math.min(between(2, 27), 28);
      const issueDate = utcDate(YEAR, month, day);
      if (issueDate > TODAY) continue;

      const item = pick(items);
      const lineCount = between(1, 3);
      const lines = Array.from({ length: lineCount }, (_, index) => {
        const chosen = index === 0 ? item : pick(items);
        const qty = chosen.unit === "hour" ? between(6, 60) : between(1, 8);
        return {
          accountId: chosen.incomeAccountId!,
          itemId: chosen.id,
          description: `${chosen.name}${index === 0 ? "" : " — additional scope"}`,
          quantityMilli: qty * 1000,
          unitPriceCents: chosen.unitPriceCents,
          taxCodeId: customer.taxCodeId,
          projectId: customer.id === customers[0].id ? projects[0].id : customer.id === customers[3].id ? projects[1].id : null,
        };
      });

      const invoice = await createInvoice({
        companyId, customerId: customer.id, issueDate,
        memo: `Professional services — ${new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(issueDate)}`,
        terms: `Net ${customer.paymentTermsDays}`,
        lines, userId, post: true,
      });
      postedInvoices.push({ id: invoice.id, customerId: customer.id, totalCents: invoice.totalCents, issueDate, number: invoice.number });
    }

    // Recurring monthly overheads as vendor bills.
    for (const index of [0, 1, 2]) {
      const vendor = vendors[index];
      const issueDate = utcDate(YEAR, month, 1);
      if (issueDate > TODAY) continue;
      const amounts = [485_000, 32_400, 128_900];
      await createBill({
        companyId, vendorId: vendor.record.id, issueDate,
        vendorInvoiceNo: `${vendor.record.name.slice(0, 3).toUpperCase()}-${YEAR}${String(month).padStart(2, "0")}`,
        memo: `${vendor.record.notes} — ${new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(issueDate)}`,
        lines: [{
          accountId: vendor.expenseAccountId,
          description: vendor.record.notes ?? vendor.record.name,
          unitPriceCents: amounts[index],
          taxCodeId: vendor.taxCodeId,
        }],
        userId, post: true,
      });
    }

    // A couple of ad-hoc bills.
    for (let i = 0; i < between(1, 3); i++) {
      const vendor = pick(vendors.slice(3));
      const issueDate = utcDate(YEAR, month, between(5, 25));
      if (issueDate > TODAY) continue;
      await createBill({
        companyId, vendorId: vendor.record.id, issueDate,
        vendorInvoiceNo: `${vendor.record.name.slice(0, 2).toUpperCase()}${between(10000, 99999)}`,
        memo: vendor.record.notes ?? undefined,
        lines: [{
          accountId: vendor.expenseAccountId,
          description: vendor.record.notes ?? vendor.record.name,
          unitPriceCents: between(45_000, 890_000),
          taxCodeId: vendor.taxCodeId,
        }],
        userId, post: true,
      });
    }

    // Card and debit expenses.
    const expenseSpecs = [
      ["6050", "Client lunch — downtown", 6_500, 18_000, visa],
      ["6060", "Office supplies", 4_200, 26_000, visa],
      ["6130", "Rail travel to client site", 12_000, 46_000, visa],
      ["6030", "Design software licence", 3_900, 14_500, visa],
      ["6010", "Monthly account fee", 4_500, 4_500, chequing],
    ] as const;
    for (const [accountCode, description, min, max, bank] of expenseSpecs) {
      const date = utcDate(YEAR, month, between(3, 26));
      if (date > TODAY) continue;
      const total = between(min, max);
      const expense = await createExpense({
        companyId, date,
        paymentAccountId: bank.accountId,
        payeeName: description,
        paymentMethod: bank.type === "CREDIT_CARD" ? "CREDIT_CARD" : "DEBIT",
        memo: description,
        taxInclusive: true,
        lines: [{ accountId: code(accountCode), description, unitPriceCents: total, taxCodeId: accountCode === "6010" ? outOfScope.id : hst.id }],
        userId,
      });
      bankLines.push({
        bankAccountId: bank.id, date, description: description.toUpperCase(),
        amountCents: -total, journalEntryId: expense.journalEntryId, status: "CATEGORIZED",
        categoryAccountId: code(accountCode),
      });
    }

    // Payroll as a manual journal — the kind of entry an accountant posts.
    const payDate = utcDate(YEAR, month, 26);
    if (payDate <= TODAY) {
      const gross = between(3_800_000, 4_600_000);
      const remittance = Math.round(gross * 0.18);
      await db.$transaction((tx) =>
        postJournal(tx, {
          companyId, date: payDate,
          memo: `Payroll — ${new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(payDate)}`,
          sourceType: "MANUAL", createdById: userId,
          lines: [
            { accountId: code("6100"), debitCents: gross, description: "Salaries & wages" },
            { accountId: code("6110"), debitCents: Math.round(gross * 0.07), description: "Employer benefits" },
            { accountId: code("2300"), creditCents: remittance + Math.round(gross * 0.07), description: "Source deductions payable" },
            { accountId: code("1000"), creditCents: gross - remittance, description: "Net pay" },
          ],
        }),
      );
      bankLines.push({
        bankAccountId: chequing.id, date: payDate, description: "PAYROLL DEPOSIT BATCH",
        amountCents: -(gross - remittance), status: "CATEGORIZED", categoryAccountId: code("6100"),
      });
    }
  }

  // ── Collections: pay most invoices, leave a realistic AR tail ─────────────
  console.log("  collecting receivables…");
  for (const invoice of postedInvoices) {
    const roll = rand();
    if (roll < 0.14) continue; // still outstanding
    const customer = customers.find((c) => c.id === invoice.customerId)!;
    const payDate = addDays(invoice.issueDate, between(8, customer.paymentTermsDays + 12));
    if (payDate > TODAY) continue;

    const partial = roll > 0.90;
    const amount = partial ? Math.round(invoice.totalCents * 0.5) : invoice.totalCents;
    const payment = await recordPayment({
      companyId, type: "RECEIPT", date: payDate,
      customerId: invoice.customerId, bankAccountId: code("1000"),
      amountCents: amount, method: "EFT",
      reference: `EFT${between(100000, 999999)}`,
      memo: `Payment for ${invoice.number}`,
      allocations: [{ invoiceId: invoice.id, amountCents: amount }],
      userId,
    });
    bankLines.push({
      bankAccountId: chequing.id, date: payDate,
      description: `EFT DEPOSIT ${customer.name.toUpperCase().slice(0, 22)}`,
      amountCents: amount, journalEntryId: payment.journalEntryId, status: "MATCHED",
      matchedType: "INVOICE_PAYMENT", matchedId: payment.id,
    });
  }

  // ── Pay most of the bills ────────────────────────────────────────────────
  console.log("  paying suppliers…");
  const openBills = await db.bill.findMany({ where: { companyId, status: { in: ["OPEN", "OVERDUE"] } }, include: { vendor: true } });
  for (const bill of openBills) {
    if (rand() < 0.22) continue; // leave an AP tail
    const payDate = addDays(bill.dueDate, between(-6, 5));
    if (payDate > TODAY) continue;
    const payment = await recordPayment({
      companyId, type: "PAYMENT", date: payDate,
      vendorId: bill.vendorId, bankAccountId: code("1000"),
      amountCents: bill.balanceCents, method: "EFT",
      reference: `PAY${between(10000, 99999)}`,
      memo: `Payment to ${bill.vendor.name}`,
      allocations: [{ billId: bill.id, amountCents: bill.balanceCents }],
      userId,
    });
    bankLines.push({
      bankAccountId: chequing.id, date: payDate,
      description: `EFT PAYMENT ${bill.vendor.name.toUpperCase().slice(0, 22)}`,
      amountCents: -bill.balanceCents, journalEntryId: payment.journalEntryId, status: "MATCHED",
      matchedType: "BILL_PAYMENT", matchedId: payment.id,
    });
  }

  // A credit note for a disputed line — exercises the negative tax path.
  const creditTarget = postedInvoices[Math.floor(postedInvoices.length / 2)];
  if (creditTarget) {
    await createCreditNote({
      companyId, type: "CUSTOMER", customerId: creditTarget.customerId,
      issueDate: addDays(creditTarget.issueDate, 12),
      reason: "Scope reduction agreed with client",
      lines: [{ accountId: code("4000"), description: "Credit — reduced workshop days", unitPriceCents: 450_000, taxCodeId: hst.id }],
      userId,
    });
  }

  // ── Bank feed ────────────────────────────────────────────────────────────
  console.log("  building the bank feed…");
  for (const line of bankLines) {
    await db.bankTransaction.create({
      data: {
        companyId, bankAccountId: line.bankAccountId, date: line.date,
        description: line.description, normalizedDesc: normalizeDescription(line.description),
        amountCents: line.amountCents, status: line.status,
        journalEntryId: line.journalEntryId ?? null,
        categoryAccountId: line.categoryAccountId ?? null,
        matchedType: line.matchedType ?? null, matchedId: line.matchedId ?? null,
        importBatchId: "SEED-FEED",
      },
    });
  }

  // A fresh, uncategorised import sitting in the review queue.
  const queue = [
    ["ATLAS CLOUD SERVICES MONTHLY", -14_690],
    ["BELL BUSINESS PREAUTH", -32_400],
    ["REGUS OFFICE SOLUTIONS", -485_000],
    ["SERVICE CHARGE - BUSINESS PLAN", -4_500],
    ["UBER CANADA/UBERTRIP", -4_720],
    ["STAPLES #0142 TORONTO", -18_940],
    ["INTERAC E-TRANSFER FEE", -150],
    ["PETRO-CANADA 41287", -9_810],
    ["EFT DEPOSIT AURORA FINTECH LABS", 1_243_600],
    ["WESTJET AIRLINES YYZ", -68_400],
    ["THE KEG STEAKHOUSE TORONTO", -21_350],
    ["ADOBE SYSTEMS SUBSCRIPTION", -9_490],
    ["CITY OF TORONTO LICENCE", -12_500],
    ["EFT DEPOSIT SABLE ISLAND MEDIA", 486_450],
  ] as const;
  for (const [index, [description, amountCents]] of queue.entries()) {
    const date = addDays(TODAY, -(index + 1) * 2);
    await db.bankTransaction.create({
      data: {
        companyId, bankAccountId: amountCents < -50_000 || amountCents > 0 ? chequing.id : visa.id,
        date, description, normalizedDesc: normalizeDescription(description),
        amountCents, status: "UNMATCHED", importBatchId: "IMP-LATEST",
      },
    });
  }

  // A completed reconciliation for the first quarter.
  const q1End = utcDate(YEAR, 3, 31);
  if (q1End < TODAY) {
    const q1Transactions = await db.bankTransaction.findMany({
      where: { companyId, bankAccountId: chequing.id, date: { lte: q1End }, status: { in: ["MATCHED", "CATEGORIZED"] } },
    });
    const movement = q1Transactions.reduce((s, t) => s + t.amountCents, 0);
    const reconciliation = await db.bankReconciliation.create({
      data: {
        companyId, bankAccountId: chequing.id,
        statementStartDate: utcDate(YEAR, 1, 1), statementEndDate: q1End,
        openingBalanceCents: 8_420_000,
        closingBalanceCents: 8_420_000 + movement,
        clearedBalanceCents: 8_420_000 + movement,
        differenceCents: 0, status: "COMPLETED",
        completedAt: addDays(q1End, 4), completedById: userId, lockedAt: addDays(q1End, 4),
      },
    });
    await db.bankTransaction.updateMany({
      where: { id: { in: q1Transactions.map((t) => t.id) } },
      data: { reconciliationId: reconciliation.id, status: "RECONCILED" },
    });
  }

  // Close the first two months so the period lock is demonstrable.
  await db.fiscalPeriod.updateMany({
    where: { companyId, fiscalYear: YEAR, periodNumber: { in: [1, 2] } },
    data: { status: "CLOSED", closedAt: new Date(), closedById: userId },
  });
  await db.fiscalPeriod.updateMany({
    where: { companyId, fiscalYear: YEAR - 1 },
    data: { status: "LOCKED" },
  });

  // Budget for the Budget vs Actual report.
  const budget = await db.budget.create({ data: { companyId, name: `FY${YEAR} operating budget`, fiscalYear: YEAR } });
  const budgeted: [string, number][] = [
    ["4000", 3_600_000], ["4010", 2_100_000], ["4020", 850_000],
    ["5000", 620_000], ["6080", 485_000], ["6100", 4_200_000], ["6110", 294_000],
    ["6030", 145_000], ["6120", 32_400], ["6070", 180_000], ["6130", 90_000], ["6050", 45_000],
  ];
  await db.budgetLine.createMany({
    data: budgeted.flatMap(([accountCode, monthly]) =>
      Array.from({ length: 12 }, (_, period) => ({
        budgetId: budget.id, accountId: code(accountCode), periodNumber: period + 1, amountCents: monthly,
      })),
    ),
  });

  // Notifications & a recurring template.
  await db.notification.createMany({
    data: [
      { companyId, type: "TAX", title: "GST/HST filing due", body: `Q${Math.ceil(CURRENT_MONTH / 3)} ${YEAR} return is due in 21 days.`, severity: "WARNING", link: "/tax" },
      { companyId, type: "BANKING", title: "14 bank transactions need review", body: "A new feed import is waiting in the banking queue.", severity: "INFO", link: "/banking" },
      { companyId, type: "AR", title: "Overdue invoices", body: "Several invoices have passed their due date.", severity: "WARNING", link: "/sales/invoices?status=OVERDUE" },
    ],
  });
  await db.recurringTemplate.create({
    data: {
      companyId, type: "INVOICE", name: "Aurora Fintech — monthly advisory retainer",
      frequency: "MONTHLY", nextRunDate: utcDate(YEAR, Math.min(CURRENT_MONTH + 1, 12), 1),
      payload: JSON.stringify({ customerId: customers[4].id, lines: [{ accountId: code("4020"), description: "Advisory retainer", unitPriceCents: 850_000, taxCodeId: hst.id }] }),
      runCount: CURRENT_MONTH - 1,
    },
  });

  await db.estimate.create({
    data: {
      companyId, customerId: customers[6].id,
      number: "EST-1001", issueDate: addDays(TODAY, -9), expiryDate: addDays(TODAY, 21),
      status: "SENT", memo: "Digital service delivery review",
      subtotalCents: 4_200_000, taxCents: 546_000, totalCents: 4_746_000,
      lines: {
        create: [
          { lineNo: 1, accountId: code("4010"), description: "Discovery & stakeholder interviews", quantityMilli: 80_000, unitPriceCents: 19_500, netCents: 1_560_000, taxCodeId: hst.id, taxCents: 202_800, totalCents: 1_762_800 },
          { lineNo: 2, accountId: code("4000"), description: "Target operating model design", quantityMilli: 96_000, unitPriceCents: 27_500, netCents: 2_640_000, taxCodeId: hst.id, taxCents: 343_200, totalCents: 2_983_200 },
        ],
      },
    },
  });
}

async function buildSmallBooks(companyId: string, userId: string) {
  const { byCode } = await accountsOf(companyId);
  const code = (c: string) => byCode.get(c)!.id;
  const taxCodes = await db.taxCode.findMany({ where: { companyId } });
  const bcTax = taxCodes.find((t) => t.code === "GST-PST-BC")!;
  const hstLike = taxCodes.find((t) => t.code === "GST")!;

  await db.$transaction((tx) =>
    postJournal(tx, {
      companyId, date: utcDate(YEAR - 1, 12, 31), memo: "Opening balances", sourceType: "OPENING", createdById: userId,
      lines: [
        { accountId: code("1000"), debitCents: 2_640_000, description: "Chequing" },
        { accountId: code("1500"), debitCents: 480_000, description: "Studio equipment" },
        { accountId: code("3000"), creditCents: 500_000, description: "Common shares" },
        { accountId: code("3300"), creditCents: 2_620_000, description: "Retained earnings" },
      ],
    }),
  );

  await db.bankAccount.create({
    data: {
      companyId, accountId: code("1000"), name: "Vancity Business Chequing",
      institution: "Vancity", accountNumberMasked: "••••7723", openingBalanceCents: 2_640_000,
      openingDate: utcDate(YEAR - 1, 12, 31),
    },
  });

  const clients = await Promise.all(
    [["Wharfside Hospitality Group", "BC"], ["Cordova Bay Outfitters", "BC"], ["Riverstone Analytics", "AB"]].map(([name, province]) =>
      db.customer.create({
        data: { companyId, name, province, city: province === "BC" ? "Vancouver" : "Calgary", paymentTermsDays: 30, taxCodeId: province === "BC" ? bcTax.id : hstLike.id },
      }),
    ),
  );
  const landlord = await db.vendor.create({ data: { companyId, name: "Gastown Property Co.", taxCodeId: bcTax.id, paymentTermsDays: 15 } });

  for (let month = 1; month <= CURRENT_MONTH; month++) {
    for (const client of clients) {
      const issueDate = utcDate(YEAR, month, between(4, 20));
      if (issueDate > TODAY) continue;
      const invoice = await createInvoice({
        companyId, customerId: client.id, issueDate,
        memo: "Brand & digital design services",
        lines: [{ accountId: code("4010"), description: "Design services", quantityMilli: between(20, 70) * 1000, unitPriceCents: 14_500, taxCodeId: client.taxCodeId }],
        userId, post: true,
      });
      const receiptDate = addDays(issueDate, between(10, 34));
      if (rand() > 0.25 && receiptDate <= TODAY) {
        await recordPayment({
          companyId, type: "RECEIPT", date: receiptDate,
          customerId: client.id, bankAccountId: code("1000"),
          amountCents: invoice.totalCents, allocations: [{ invoiceId: invoice.id, amountCents: invoice.totalCents }], userId,
        });
      }
    }
    const rentDate = utcDate(YEAR, month, 1);
    if (rentDate <= TODAY) {
      await createBill({
        companyId, vendorId: landlord.id, issueDate: rentDate,
        vendorInvoiceNo: `GAS-${YEAR}${String(month).padStart(2, "0")}`,
        lines: [{ accountId: code("6080"), description: "Studio rent", unitPriceCents: 320_000, taxCodeId: bcTax.id }],
        userId, post: true,
      });
    }
  }
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });

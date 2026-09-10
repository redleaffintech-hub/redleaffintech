/**
 * Phase 7 — Neon → Firestore data migration.
 *
 * Reads every Prisma table from the live Postgres database and writes it to
 * Cloud Firestore, preserving document ids so every stored foreign-key string
 * keeps pointing at the right document.
 *
 *   npx tsx scripts/migrate-to-firestore.ts [--dry-run] [--only=invoices,bills] [--yes]
 *
 * Requires (same as any Firestore-touching script):
 *   - DATABASE_URL (Neon)  — via .env.local / vercel env pull
 *   - GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT (a service
 *     account for redleaf-fintech-e4c4d)
 *
 * SAFE TO RE-RUN. Every write is an id-addressed `.set()` (overwrite), so a
 * partial run is fixed by running again. It never deletes.
 *
 * What it does NOT do: touch Firebase Auth (Phase 5 concern — password/session
 * fields ride along on the `users` docs and are ignored once Auth owns them).
 *
 * ── The shape rules (see FIREBASE-MIGRATION.md §2) ────────────────────────────
 *
 *   - Prisma field names already match the Firestore document field names — the
 *     repos were built to mirror them — so the transform is mostly Date →
 *     Timestamp plus a handful of structural changes below.
 *   - Line-item children (Invoice/Estimate/Bill/CreditNote/Expense lines,
 *     TaxComponents, BudgetLines, PayRunLines, Plan prices/features/modules,
 *     Customer/Vendor contacts) are EMBEDDED as arrays on the parent, not their
 *     own collection.
 *   - CompanyUser and FirmUser get the deterministic id `${a}__${b}` the app
 *     always computes; Session and SubscriptionCompany get their natural key.
 *     Everything else keeps its Prisma cuid.
 *   - Guard docs (accountCodes / taxCodeCodes / itemCodes / userEmails) are
 *     written alongside the row they protect.
 *   - accountPeriodBalances (the reporting roll-up) is rebuilt from journalLines
 *     after the import.
 */

import "./load-env";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/lib/db";
import { firestore as fs } from "../src/lib/firebase-admin";

// ── args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CONFIRMED = args.includes("--yes");
const ONLY = (() => {
  const a = args.find((x) => x.startsWith("--only="));
  return a ? new Set(a.slice("--only=".length).split(",").map((s) => s.trim())) : null;
})();

const want = (name: string) => !ONLY || ONLY.has(name);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Deep-convert every Date to a Firestore Timestamp. Leaves everything else. */
function deepDates<T>(value: T): T {
  if (value instanceof Date) return Timestamp.fromDate(value) as unknown as T;
  if (Array.isArray(value)) return value.map(deepDates) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepDates(v);
    return out as T;
  }
  return value;
}

/** Clone a Prisma row, drop `omit` keys, deep-convert dates. */
function fsData(row: Record<string, unknown>, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    out[k] = v;
  }
  return deepDates(out);
}

const PROGRESS_EVERY = 500;

interface Sink {
  set(path: string, id: string, data: Record<string, unknown>): void;
  written: number;
}

function makeSink(): Sink & { close(): Promise<void> } {
  if (DRY_RUN) {
    const s = { written: 0, set() { this.written++; }, async close() {} };
    return s as Sink & { close(): Promise<void> };
  }
  const bw = fs.bulkWriter();
  bw.onWriteError((err) => {
    if (err.failedAttempts < 5) return true;
    console.error(`  write failed after ${err.failedAttempts} attempts: ${err.documentRef.path}`, err.message);
    return false;
  });
  let written = 0;
  return {
    get written() { return written; },
    set(path, id, data) {
      void bw.set(fs.collection(path).doc(id), data, { merge: false });
      written++;
      if (written % PROGRESS_EVERY === 0) process.stdout.write(`\r    …${written} docs queued`);
    },
    async close() {
      await bw.close();
      if (written >= PROGRESS_EVERY) process.stdout.write(`\r    ${written} docs written    \n`);
    },
  };
}

// ── job model ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// Prisma's generated per-model types are elaborate; this migration only needs
// "a bag of fields", so the model accessors are treated loosely on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PrismaModel = { findMany(a?: any): Promise<any[]> };

interface Job {
  /** `--only` key and log label. */
  name: string;
  /** Fetch every row (with whatever `include` the transform needs). */
  fetch(): Promise<Row[]>;
  /**
   * Emit one or more Firestore writes for a row. `sink.set(collectionPath, docId, data)`.
   * Collection path is the FULL path, e.g. `companies/abc/invoices`.
   */
  emit(row: Row, sink: Sink): void;
}

/** A plain tenant subcollection: `companies/{companyId}/<sub>/{id}`, keep cuid. */
function tenantJob(
  name: string,
  model: PrismaModel,
  sub: string,
  opts: {
    include?: Record<string, unknown>;
    transform?: (row: Row) => Row;
    /** Some child tables have no companyId column — derive it. */
    companyId?: (row: Row) => string | undefined;
  } = {},
): Job {
  return {
    name,
    fetch: () =>
      model.findMany(opts.include ? { include: opts.include } : undefined) as Promise<Row[]>,
    emit(row, sink) {
      const companyId = (opts.companyId?.(row) ?? row.companyId) as string | undefined;
      if (!companyId) {
        console.warn(`  ${name}: row ${String(row.id)} has no companyId — skipped`);
        return;
      }
      const data = opts.transform ? opts.transform(row) : fsData(row);
      data.companyId = companyId;
      sink.set(`companies/${companyId}/${sub}`, String(row.id), data);
    },
  };
}

/** A plain top-level collection, keep cuid. */
function topJob(
  name: string,
  model: PrismaModel,
  collection: string,
  opts: { include?: Record<string, unknown>; transform?: (row: Row) => Row; docId?: (row: Row) => string } = {},
): Job {
  return {
    name,
    fetch: () =>
      model.findMany(opts.include ? { include: opts.include } : undefined) as Promise<Row[]>,
    emit(row, sink) {
      const data = opts.transform ? opts.transform(row) : fsData(row);
      sink.set(collection, opts.docId ? opts.docId(row) : String(row.id), data);
    },
  };
}

/** Embed line children onto the parent, dropping each line's parent-id backref. */
function withLines(row: Row, key: string, backref: string): Row {
  const lines = ((row[key] as Row[]) ?? []).map((l) => fsData(l, [backref]));
  return { ...fsData(row, [key]), lines };
}

// ── jobs ────────────────────────────────────────────────────────────────────

const jobs: Job[] = [
  // ---- platform / top-level ----
  topJob("firms", db.firm, "firms"),
  topJob("firmUsers", db.firmUser, "firmUsers", { docId: (r) => `${r.firmId}__${r.userId}` }),
  topJob("regionalTaxRates", db.regionalTaxRate, "regionalTaxRates"),
  topJob("planVersions", db.planVersion, "planVersions"),
  topJob("subscriptions", db.subscription, "subscriptions"),
  topJob("subscriptionCompanies", db.subscriptionCompany, "subscriptionCompanies", { docId: (r) => String(r.companyId) }),
  topJob("subscriptionEvents", db.subscriptionEvent, "subscriptionEvents"),
  topJob("subscriptionNotes", db.subscriptionNote, "subscriptionNotes"),
  topJob("platformAuditLogs", db.platformAuditLog, "platformAuditLogs"),
  topJob("authAttempts", db.authAttempt, "authAttempts"),
  topJob("userTokens", db.userToken, "userTokens"),

  {
    name: "users",
    fetch: () => db.user.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      sink.set("users", String(row.id), fsData(row));
      const email = String(row.email ?? "").toLowerCase();
      if (email) sink.set("userEmails", email, { uid: String(row.id) });
    },
  },
  {
    name: "sessions",
    fetch: () => db.session.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      // doc id = token (getSessionByToken reads by it).
      sink.set("sessions", String(row.token), fsData(row));
    },
  },
  {
    name: "companyUsers",
    fetch: () => db.companyUser.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      sink.set("companyUsers", `${row.companyId}__${row.userId}`, fsData(row));
    },
  },
  {
    name: "plans",
    fetch: () =>
      db.plan.findMany({
        include: { prices: true, features: { orderBy: { sortOrder: "asc" } }, modules: true },
      }) as unknown as Promise<Row[]>,
    emit(row, sink) {
      const prices = ((row.prices as Row[]) ?? []).map((p) => ({
        cycle: p.cycle,
        cycleAmountCents: p.cycleAmountCents,
        monthlyEquivalentCents: p.monthlyEquivalentCents,
      }));
      const features = ((row.features as Row[]) ?? [])
        .slice()
        .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
        .map((f) => f.label as string);
      const modules = ((row.modules as Row[]) ?? []).map((m) => m.moduleId as string);
      sink.set("plans", String(row.id), {
        ...fsData(row, ["prices", "features", "modules"]),
        prices,
        features,
        modules,
      });
    },
  },

  // ---- the company doc itself ----
  {
    name: "companies",
    fetch: () => db.company.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      sink.set("companies", String(row.id), fsData(row));
    },
  },

  // ---- tenant-owned ----
  {
    name: "accounts",
    fetch: () => db.account.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      const cid = String(row.companyId);
      sink.set(`companies/${cid}/accounts`, String(row.id), fsData(row));
      sink.set(`companies/${cid}/accountCodes`, String(row.code), { accountId: String(row.id) });
    },
  },
  {
    name: "taxCodes",
    fetch: () => db.taxCode.findMany({ include: { components: { orderBy: { sortOrder: "asc" } } } }) as unknown as Promise<Row[]>,
    emit(row, sink) {
      const cid = String(row.companyId);
      const components = ((row.components as Row[]) ?? []).map((c) => fsData(c, ["taxCodeId"]));
      sink.set(`companies/${cid}/taxCodes`, String(row.id), { ...fsData(row, ["components"]), components });
      sink.set(`companies/${cid}/taxCodeCodes`, String(row.code), { taxCodeId: String(row.id) });
    },
  },
  tenantJob("taxPeriods", db.taxPeriod, "taxPeriods"),
  tenantJob("taxEntries", db.taxEntry, "taxEntries"),
  tenantJob("fiscalPeriods", db.fiscalPeriod, "fiscalPeriods"),
  tenantJob("fiscalCalendarChanges", db.fiscalCalendarChange, "fiscalCalendarChanges"),
  {
    name: "customers",
    fetch: () => db.customer.findMany({ include: { contacts: true } }) as unknown as Promise<Row[]>,
    emit(row, sink) {
      const contacts = ((row.contacts as Row[]) ?? []).map((c) => fsData(c, ["customerId", "vendorId"]));
      sink.set(`companies/${row.companyId}/customers`, String(row.id), {
        ...fsData(row, ["contacts"]),
        contacts,
      });
    },
  },
  {
    name: "vendors",
    fetch: () => db.vendor.findMany({ include: { contacts: true } }) as unknown as Promise<Row[]>,
    emit(row, sink) {
      const contacts = ((row.contacts as Row[]) ?? []).map((c) => fsData(c, ["customerId", "vendorId"]));
      sink.set(`companies/${row.companyId}/vendors`, String(row.id), {
        ...fsData(row, ["contacts"]),
        contacts,
      });
    },
  },
  {
    name: "items",
    fetch: () => db.serviceItem.findMany() as unknown as Promise<Row[]>,
    emit(row, sink) {
      const cid = String(row.companyId);
      sink.set(`companies/${cid}/items`, String(row.id), fsData(row));
      sink.set(`companies/${cid}/itemCodes`, String(row.code), { itemId: String(row.id) });
    },
  },
  tenantJob("inventoryMovements", db.inventoryMovement, "inventoryMovements"),

  tenantJob("estimates", db.estimate, "estimates", {
    include: { lines: { orderBy: { lineNo: "asc" } } },
    transform: (r) => withLines(r, "lines", "estimateId"),
  }),
  tenantJob("invoices", db.invoice, "invoices", {
    include: { lines: { orderBy: { lineNo: "asc" } } },
    transform: (r) => withLines(r, "lines", "invoiceId"),
  }),
  tenantJob("creditNotes", db.creditNote, "creditNotes", {
    include: { lines: { orderBy: { lineNo: "asc" } } },
    transform: (r) => withLines(r, "lines", "creditNoteId"),
  }),
  tenantJob("bills", db.bill, "bills", {
    include: { lines: { orderBy: { lineNo: "asc" } } },
    transform: (r) => withLines(r, "lines", "billId"),
  }),
  tenantJob("expenses", db.expense, "expenses", {
    include: { lines: { orderBy: { lineNo: "asc" } } },
    transform: (r) => withLines(r, "lines", "expenseId"),
  }),

  tenantJob("payments", db.payment, "payments"),
  {
    // PaymentAllocation has no companyId column — derive it from whatever it points at.
    name: "paymentAllocations",
    async fetch() {
      const rows = await db.paymentAllocation.findMany();
      // Build id → companyId maps once.
      const [pay, inv, bill, cn] = await Promise.all([
        db.payment.findMany({ select: { id: true, companyId: true } }),
        db.invoice.findMany({ select: { id: true, companyId: true } }),
        db.bill.findMany({ select: { id: true, companyId: true } }),
        db.creditNote.findMany({ select: { id: true, companyId: true } }),
      ]);
      const map = new Map<string, string>();
      for (const r of [...pay, ...inv, ...bill, ...cn]) map.set(r.id, r.companyId);
      return rows.map((r) => ({ ...r, _companyId: map.get(
        (r.paymentId ?? r.invoiceId ?? r.billId ?? r.creditNoteId) as string,
      ) }));
    },
    emit(row, sink) {
      const cid = row._companyId as string | undefined;
      if (!cid) {
        console.warn(`  paymentAllocations: ${String(row.id)} could not be attributed to a company — skipped`);
        return;
      }
      const data = fsData(row, ["_companyId"]);
      data.companyId = cid;
      sink.set(`companies/${cid}/paymentAllocations`, String(row.id), data);
    },
  },
  tenantJob("journalEntries", db.journalEntry, "journalEntries"),
  tenantJob("journalLines", db.journalLine, "journalLines"),

  tenantJob("bankAccounts", db.bankAccount, "bankAccounts"),
  tenantJob("bankTransactions", db.bankTransaction, "bankTransactions"),
  tenantJob("bankRules", db.bankRule, "bankRules"),
  tenantJob("bankReconciliations", db.bankReconciliation, "bankReconciliations"),
  tenantJob("bankReconciliationMatches", db.bankReconciliationMatch, "bankReconciliationMatches"),

  tenantJob("attachments", db.attachment, "attachments"),
  tenantJob("auditLogs", db.auditLog, "auditLogs"),
  tenantJob("notifications", db.notification, "notifications"),
  tenantJob("projects", db.project, "projects"),
  tenantJob("budgets", db.budget, "budgets", {
    include: { lines: true },
    transform: (r) => withLines(r, "lines", "budgetId"),
  }),
  tenantJob("recurring", db.recurringTemplate, "recurring"),

  tenantJob("departments", db.department, "departments"),
  tenantJob("employees", db.employee, "employees"),
  tenantJob("leaveTypes", db.leaveType, "leaveTypes"),
  tenantJob("leaveRequests", db.leaveRequest, "leaveRequests"),
  tenantJob("leaveBalanceAdjustments", db.leaveBalanceAdjustment, "leaveBalanceAdjustments"),
  tenantJob("payRuns", db.payRun, "payRuns", {
    include: { lines: true },
    transform: (r) => withLines(r, "lines", "payRunId"),
  }),
];

// ── accountPeriodBalances rebuild ───────────────────────────────────────────

async function rebuildBalances(sink: Sink) {
  console.log("\naccountPeriodBalances (rebuilt from journalLines)");
  const lines = await db.journalLine.findMany({
    select: {
      companyId: true,
      accountId: true,
      accountType: true,
      date: true,
      debitCents: true,
      creditCents: true,
    },
  });
  // key: `${companyId}|${accountId}|${YYYYMM}`
  const agg = new Map<
    string,
    { companyId: string; accountId: string; accountType: string; year: number; month: number; debitCents: number; creditCents: number }
  >();
  for (const l of lines) {
    const year = l.date.getUTCFullYear();
    const month = l.date.getUTCMonth() + 1;
    const yyyymm = `${year}${String(month).padStart(2, "0")}`;
    const key = `${l.companyId}|${l.accountId}|${yyyymm}`;
    const cur =
      agg.get(key) ??
      { companyId: l.companyId, accountId: l.accountId, accountType: l.accountType, year, month, debitCents: 0, creditCents: 0 };
    cur.debitCents += l.debitCents;
    cur.creditCents += l.creditCents;
    agg.set(key, cur);
  }
  for (const b of agg.values()) {
    const yyyymm = `${b.year}${String(b.month).padStart(2, "0")}`;
    sink.set(`companies/${b.companyId}/accountPeriodBalances`, `${b.accountId}_${yyyymm}`, {
      accountId: b.accountId,
      accountType: b.accountType,
      year: b.year,
      month: b.month,
      periodKey: b.year * 100 + b.month,
      debitCents: b.debitCents,
      creditCents: b.creditCents,
    });
  }
  console.log(`  ${agg.size} roll-up docs`);
}

// ── verification ────────────────────────────────────────────────────────────

async function verify() {
  console.log("\n── verification ─────────────────────────────────────────────");
  let problems = 0;

  // 1. Per-company trial balance: Prisma journalLines vs Firestore roll-up.
  const companies = await db.company.findMany({ select: { id: true, name: true } });
  for (const c of companies) {
    const pgLines = await db.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId: c.id },
      _sum: { debitCents: true, creditCents: true },
    });
    const pg = new Map(pgLines.map((r) => [r.accountId, {
      d: r._sum.debitCents ?? 0,
      cr: r._sum.creditCents ?? 0,
    }]));
    const pgDebit = [...pg.values()].reduce((s, v) => s + v.d, 0);
    const pgCredit = [...pg.values()].reduce((s, v) => s + v.cr, 0);

    const snap = await fs.collection(`companies/${c.id}/accountPeriodBalances`).get();
    const fsAcc = new Map<string, { d: number; cr: number }>();
    for (const d of snap.docs) {
      const raw = d.data();
      const cur = fsAcc.get(raw.accountId) ?? { d: 0, cr: 0 };
      cur.d += raw.debitCents ?? 0;
      cur.cr += raw.creditCents ?? 0;
      fsAcc.set(raw.accountId, cur);
    }
    const fsDebit = [...fsAcc.values()].reduce((s, v) => s + v.d, 0);
    const fsCredit = [...fsAcc.values()].reduce((s, v) => s + v.cr, 0);

    const balanced = pgDebit === pgCredit && fsDebit === fsCredit;
    const matches = pgDebit === fsDebit && pgCredit === fsCredit;
    let perAccountOk = fsAcc.size === pg.size;
    for (const [id, v] of pg) {
      const f = fsAcc.get(id);
      if (!f || f.d !== v.d || f.cr !== v.cr) perAccountOk = false;
    }

    const flag = balanced && matches && perAccountOk ? "ok " : "!! ";
    if (flag === "!! ") problems++;
    console.log(
      `  ${flag}${c.name.padEnd(28)} ` +
        `PG Dr ${(pgDebit / 100).toFixed(2)} / Cr ${(pgCredit / 100).toFixed(2)}  |  ` +
        `FS Dr ${(fsDebit / 100).toFixed(2)} / Cr ${(fsCredit / 100).toFixed(2)}` +
        (perAccountOk ? "" : "  [per-account mismatch]"),
    );
  }

  // 2. Row counts for the collections most likely to lose rows.
  console.log("\n  collection counts (Prisma → Firestore)");
  const countChecks: Array<[string, () => Promise<number>, (cid: string) => string]> = [
    ["invoices", () => db.invoice.count(), (cid) => `companies/${cid}/invoices`],
    ["bills", () => db.bill.count(), (cid) => `companies/${cid}/bills`],
    ["payments", () => db.payment.count(), (cid) => `companies/${cid}/payments`],
    ["journalEntries", () => db.journalEntry.count(), (cid) => `companies/${cid}/journalEntries`],
    ["journalLines", () => db.journalLine.count(), (cid) => `companies/${cid}/journalLines`],
    ["customers", () => db.customer.count(), (cid) => `companies/${cid}/customers`],
    ["vendors", () => db.vendor.count(), (cid) => `companies/${cid}/vendors`],
    ["taxEntries", () => db.taxEntry.count(), (cid) => `companies/${cid}/taxEntries`],
  ];
  for (const [label, pgCount, path] of countChecks) {
    const pg = await pgCount();
    let fsN = 0;
    for (const c of companies) {
      const agg = await fs.collection(path(c.id)).count().get();
      fsN += agg.data().count;
    }
    const flag = pg === fsN ? "ok " : "!! ";
    if (flag === "!! ") problems++;
    console.log(`  ${flag}${label.padEnd(18)} ${pg} → ${fsN}`);
  }

  // 3. Top-level counts.
  const topChecks: Array<[string, () => Promise<number>, string]> = [
    ["users", () => db.user.count(), "users"],
    ["companyUsers", () => db.companyUser.count(), "companyUsers"],
    ["subscriptions", () => db.subscription.count(), "subscriptions"],
    ["plans", () => db.plan.count(), "plans"],
    ["planVersions", () => db.planVersion.count(), "planVersions"],
    ["regionalTaxRates", () => db.regionalTaxRate.count(), "regionalTaxRates"],
  ];
  for (const [label, pgCount, coll] of topChecks) {
    const pg = await pgCount();
    const fsN = (await fs.collection(coll).count().get()).data().count;
    const flag = pg === fsN ? "ok " : "!! ";
    if (flag === "!! ") problems++;
    console.log(`  ${flag}${label.padEnd(18)} ${pg} → ${fsN}`);
  }

  console.log(
    problems === 0
      ? "\n✅ verification clean\n"
      : `\n❌ ${problems} check${problems === 1 ? "" : "s"} failed — do not cut over\n`,
  );
  return problems;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const project =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    (process.env.FIREBASE_SERVICE_ACCOUNT
      ? (JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id as string)
      : "(ADC default)");

  console.log(`Neon → Firestore migration`);
  console.log(`  target project : ${project}`);
  console.log(`  mode           : ${DRY_RUN ? "DRY RUN (counts only, no writes)" : "LIVE WRITE"}`);
  if (ONLY) console.log(`  only           : ${[...ONLY].join(", ")}`);

  if (!DRY_RUN && !CONFIRMED) {
    console.log(
      `\nThis writes to Firestore in project "${project}". Re-run with --yes to proceed,\n` +
        `or --dry-run to see counts first.`,
    );
    await db.$disconnect();
    process.exit(1);
  }

  const runVerifyOnly = ONLY?.has("verify") && ONLY.size === 1;

  if (!runVerifyOnly) {
    const sink = makeSink();
    for (const job of jobs) {
      if (!want(job.name)) continue;
      const rows = await job.fetch();
      process.stdout.write(`${job.name.padEnd(26)} ${String(rows.length).padStart(6)} rows`);
      const before = sink.written;
      for (const row of rows) job.emit(row, sink);
      process.stdout.write(`  →  ${sink.written - before} docs\n`);
    }
    if (want("accountPeriodBalances")) await rebuildBalances(sink);
    await sink.close();
    console.log(`\n${DRY_RUN ? "would write" : "wrote"} ${sink.written} documents.`);
  }

  let problems = 0;
  if (!DRY_RUN && (!ONLY || ONLY.has("verify"))) {
    problems = await verify();
  }

  await db.$disconnect();
  process.exit(problems === 0 ? 0 : 2);
}

main().catch(async (e) => {
  console.error("\nMIGRATION FAILED:", e instanceof Error ? e.stack : e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

# Firebase migration — design & plan

Branch: `firebase-migration`. Target: Next.js on **Firebase App Hosting**, data in
**Cloud Firestore**, identity via **Firebase Auth**. Postgres/Prisma/Neon are
removed at the end.

> **This is a backend rewrite, not a config change.** ~50 Prisma models, ~100
> files in the data layer, 66 transaction sites, and a reporting layer built on
> SQL aggregation that Firestore does not have. It is delivered in phases; each
> phase is committed to this branch and leaves the app buildable.

---

## 1. Cost reality (read before enabling anything)

- **App Hosting requires the Blaze plan** (a card on the Firebase project). There
  is no free tier. Low traffic sits in Blaze's small monthly no-cost allowance;
  past that it is per Cloud Run vCPU/memory-second + per-GB egress.
- **Firestore bills per document read.** Every report page reads many docs. The
  aggregation design in §4 exists to keep that bounded; without it a trial
  balance for one active company is thousands of reads per load.
- Firestore free quota (Blaze still shows it): 50k reads / 20k writes / 20k
  deletes per day, 1 GiB storage, 10 GiB/mo egress. A handful of active
  bookkeepers running reports can exceed 50k reads/day.

If the goal is "cheapest", this migration works against it. It is being done
because it was explicitly chosen with these trade-offs understood.

---

## 2. Collection layout

Document ids: existing Postgres cuids are preserved as Firestore doc ids on
import, so every stored foreign-key string keeps pointing at the right doc. New
docs get a UUID from `newId()`.

### Top-level (platform / cross-tenant — boundary is `isPlatformAdmin`, not a companyId)

| Collection | From model | Notes |
|---|---|---|
| `users/{uid}` | User | `uid` = Firebase Auth uid after §5. Password/MFA fields drop once Auth owns them. |
| `sessions/{id}` | Session | Kept for admin-scope + step-up MFA tracking until §5 replaces with Auth + custom claims. |
| `companyUsers/{id}` | CompanyUser | Indexed by `userId` and by `companyId`. The membership/role join. |
| `firms/{id}`, `firmUsers/{id}` | Firm, FirmUser | |
| `plans/{id}` | Plan | `prices`, `features`, `modules` embedded as arrays (small, always read together). |
| `planVersions/{id}` | PlanVersion | Immutable snapshots; own collection because it grows. |
| `subscriptions/{id}` | Subscription | `companyId` field; admin queries by `status`, `trialEndsAt`, `currentPeriodEnd`. |
| `subscriptionEvents/{id}`, `subscriptionNotes/{id}`, `subscriptionCompanies/{id}` | resp. | `subscriptionId` field. |
| `regionalTaxRates/{id}` | RegionalTaxRate | Reference table. |
| `platformAuditLogs/{id}` | PlatformAuditLog | Append-only. |
| `authAttempts/{id}` | AuthAttempt | High write volume. **Firestore TTL on `createdAt`** (see `firestore.indexes.json`). |
| `userTokens/{id}` | UserToken | Invite / reset tokens (hash only). TTL on `expiresAt`. |

### Tenant-owned — `companies/{companyId}/<name>/{id}`

`companies/{companyId}` holds the company doc **including the numbering counters**
(`nextInvoiceNumber`, `nextJournalNumber`, …) which are bumped inside posting
transactions.

| Subcollection | From model | Embedded children | Queried independently by |
|---|---|---|---|
| `accounts` | Account | — | `type`, `systemKey`, `parentId` |
| `taxCodes` | TaxCode | `components[]` (TaxComponent) | `isActive` |
| `taxPeriods` | TaxPeriod | — | `startDate` |
| `taxEntries` | TaxEntry | — | `date`, `direction`, `sourceType`+`sourceId`, `taxPeriodId` |
| `fiscalPeriods` | FiscalPeriod | — | `fiscalYear`+`periodNumber`, `startDate` |
| `fiscalCalendarChanges` | FiscalCalendarChange | — | `effectiveDate` |
| `customers` | Customer | `contacts[]` | `isActive` |
| `vendors` | Vendor | `contacts[]` | `isActive` |
| `items` | ServiceItem | — | `isActive` |
| `inventoryMovements` | InventoryMovement | — | `itemId`+`date`, `sourceType`+`sourceId` |
| `estimates` | Estimate | `lines[]` | `status` |
| `invoices` | Invoice | `lines[]` | `status`, `issueDate`, `customerId` |
| `creditNotes` | CreditNote | `lines[]` | `type`+`status` |
| `bills` | Bill | `lines[]` | `status`, `issueDate`, `vendorId` |
| `expenses` | Expense | `lines[]` | `date`, `status` |
| `payments` | Payment | — | `date`, `type` |
| `paymentAllocations` | PaymentAllocation | — | `invoiceId`, `billId`, `creditNoteId` |
| `journalEntries` | JournalEntry | — | `date`, `sourceType`+`sourceId` |
| `journalLines` | JournalLine | — | `date`, `accountId`+`date`, `accountType`+`date` — **the report scan table** |
| `accountPeriodBalances` | *(new — §4)* | — | doc id = `{accountId}_{YYYYMM}` |
| `bankAccounts` | BankAccount | — | — |
| `bankTransactions` | BankTransaction | — | `bankAccountId`+`date`, `status`, `fitId` |
| `bankRules` | BankRule | — | `isActive` |
| `bankReconciliations` | BankReconciliation | — | `bankAccountId`, `statementYear`+`statementMonth` |
| `bankReconciliationMatches` | BankReconciliationMatch | — | `reconciliationId`, `bankAccountId` |
| `attachments` | Attachment | — | `sourceType`+`sourceId` |
| `auditLogs` | AuditLog | — | `createdAt`, `entityType`+`entityId` |
| `notifications` | Notification | — | `isRead` |
| `projects` | Project | — | — |
| `budgets` | Budget | `lines[]` | `fiscalYear` |
| `recurring` | RecurringTemplate | — | `isActive`, `nextRunDate` |
| `departments`, `employees`, `leaveTypes`, `leaveRequests`, `leaveBalanceAdjustments` | HR models | — | per model |
| `payRuns` | PayRun | `lines[]` (PayRunLine) | `status`, `payDate` |

Rule of thumb for embed vs subcollection: **embed** when the children are always
read with the parent, are bounded (< ~50), and are never queried across parents
(document lines). **Subcollection** when queried independently (`journalLines`,
`taxEntries`, `paymentAllocations`, `inventoryMovements`).

### Cross-company reads for platform admin

Firm portfolio views and `/admin` client lists use **collection-group queries**
(`db.collectionGroup("invoices").where("companyId","==",…)`), so every
tenant-owned doc also carries a redundant `companyId` field. Collection-group
composite indexes are declared in `firestore.indexes.json`.

---

## 3. Uniqueness (Firestore has no unique constraint)

| Prisma constraint | Firestore mechanism |
|---|---|
| `User.email` | Firebase Auth owns email uniqueness after §5. Until then: `userEmails/{email}` → `{uid}` guard doc. |
| `Session.token`, `UserToken.tokenHash` | doc id = the hash. |
| `Account @@unique([companyId, code])` | guard doc `companies/{c}/accountCodes/{code}` → `{accountId}`, written in the same transaction. |
| `TaxCode @@unique([companyId, code])` | same pattern, `taxCodeCodes`. |
| `JournalEntry @@unique([companyId, entryNo])`, `Invoice/Bill/... number` | the per-company counter + transaction guarantees no collision. |
| `@@unique([companyId, fiscalYear, periodNumber])` etc. | deterministic doc id, e.g. `fiscalPeriods/{fiscalYear}-{periodNumber}`. |
| `BankReconciliation @@unique([companyId,bankAccountId,statementYear,statementMonth])` | doc id = `{bankAccountId}_{year}-{month}`. |

`cuid`-style random ids are still used where the natural key is not safe as a
path segment (contains `/`, too long, user-supplied).

---

## 4. Reporting — the hard part

Prisma reports run `groupBy(accountId) + _sum(debit/credit)` over `JournalLine`
filtered by `companyId + date range (+ accountType)`. Firestore has **no
GROUP BY and no cross-document SUM beyond a single aggregation query**.

**Solution: `accountPeriodBalances` roll-up docs, maintained transactionally.**

```
companies/{companyId}/accountPeriodBalances/{accountId}_{YYYYMM}
  { accountId, accountType, year, month,
    debitCents, creditCents }          // += on every posted line
```

- Every `postJournal` transaction, for each line, also does a
  `tx.set(balanceDoc, { debitCents: FieldValue.increment(d), creditCents: FieldValue.increment(c) }, { merge:true })`.
- **Trial balance / Balance sheet / P&L** read the balance docs for the month
  range (≤ 12 × active-accounts docs) instead of scanning every line.
- **General ledger** (line-level, one account) still queries `journalLines`
  directly — bounded by account + date.
- **Reversals / voids** post opposite lines, so the increments self-correct.
- Opening balances and year-end close write balance docs too.

Aging (AR/AP) is driven by `invoices`/`bills` + `paymentAllocations`, not the GL,
so it ports as ordinary queries with an as-of-date filter.

Tax summary/detail read `taxEntries` by date+direction; small enough to sum in
app code, or add a `taxPeriodTotals` roll-up if a company's volume needs it.

---

## 5. Auth

| Now | After |
|---|---|
| `User.passwordHash` (bcrypt), `Session` cookie (jose JWT), scope APP/ADMIN | Firebase Auth email/password. Session cookie = Firebase **session cookie**. |
| `isPlatformAdmin`, `platformAdminSuspendedAt` | Auth **custom claims** `{ platformAdmin: true }`, re-checked against the `users` doc on every admin guard (suspension must take effect without a token refresh). |
| `CompanyUser.role` | stays in Firestore; loaded per request. Not a claim (too many, changes often). |
| MFA (`mfaSecret` TOTP, step-up) | Firebase Auth multi-factor (TOTP) — enrolment + step-up reverified server-side. |
| `AuthAttempt` rate limiting | keep — Auth doesn't expose per-email attempt counts. |
| password reset / invite `UserToken` | keep the hashed-token collection; Auth's own reset email flow is not used so the product controls the UX. |

`src/server/auth/*` is rewritten against Firebase Auth. `middleware`/`proxy.ts`
verifies the session cookie.

---

## 6. Transactions

`db.$transaction(fn)` → `runTransaction(fn)` from `src/server/db/firestore.ts`.

Constraints callers must meet:
- all `tx.get(...)` before any `tx.set/update/delete`;
- ≤ 500 writes per transaction;
- callback is retried on contention — no side effects, generate ids up-front.

**Year-end close** (`closeFiscalYear`) sweeps every revenue/expense account. With
the roll-up docs the *reads* are bounded, but writing the closing entry's lines +
balance docs for a company with > ~200 income-statement accounts can exceed 500
writes. Mitigation: compute in a transaction, then write the closing
`JournalEntry` + its `journalLines` + balance increments via `BulkWriter` with an
idempotency guard (`journalEntries` where `sourceType==CLOSING` and `date==end`).
Documented as a deliberate deviation from strict single-transaction atomicity.

---

## 7. Phased plan

- [x] **Phase 0 — branch + scaffold.** `.firebaserc`, `firebase.json`,
  `firestore.rules` (deny-all; server SDK bypasses), `firestore.indexes.json`,
  `apphosting.yaml`, `src/lib/firebase-admin.ts`, `src/server/db/firestore.ts`,
  this document. Deps: `firebase-admin`, `firebase`.
- [x] **Phase 1 — data-access layer.** `src/server/db/`: `types.ts`,
  `companies.ts` (+ `bumpSequenceTx`), `accounts.ts` (+ code guard doc),
  `users.ts` (+ email guard), `company-users.ts`, `audit-logs.ts`. Call sites
  still on Prisma; rewired per module in later phases.
- [x] **Phase 2 — posting engine.** `src/server/accounting/ledger-fs.ts`
  (`postJournal`, `reverseJournal`, `getSystemAccount`, `resolveOpenPeriod`,
  `naturalBalance`, `checkLedgerIntegrity`) and `journals-fs.ts`
  (`postManualJournal`, `closePeriod`, `reopenPeriod`, `closeFiscalYear`,
  `postOpeningBalances`) on `runTransaction`. New repos: `journal-entries.ts`,
  `fiscal-periods.ts`, `account-balances.ts` (the `accountPeriodBalances`
  roll-up, incremented per line inside every posting tx). Composite indexes
  declared. `closeChecklist` deferred to Phase 5. Year-end close over ~240
  income-statement accounts still needs the BulkWriter fallback (§6).
- [x] **Phase 3 — document data layer.** Repos for the master data documents
  need: `customers.ts`, `vendors.ts`, `items.ts` (+ `itemCodes` guard). Shared
  `_doc-repo.ts` factory (embedded `lines[]`, `journalEntryId`) backing
  `invoices.ts`, `estimates.ts`, `bills.ts`, `expenses.ts`, `credit-notes.ts`.
  `payments.ts` + `payment-allocations.ts` (own collection — aging queries it by
  invoiceId/billId). `companies.peekSequence`. Converter helper in `firestore.ts`
  cuts per-repo boilerplate.
  **Deferred to Phase 4:** the posting-path service functions
  (`createInvoice`/`postInvoice`/`voidInvoice`/`recordPayment`/…) — they call the
  tax engine and inventory costing, which land in Phase 4.
- [x] **Phase 4 — tax engine, inventory, and the first posting flows.**
  Repos: `tax-codes.ts` (+ `taxCodeCodes` guard), `tax-periods.ts`,
  `tax-entries.ts`, `inventory-movements.ts`. Engine wrappers:
  `tax/engine-fs.ts` (pure arithmetic re-exported; `loadTaxCodesTx`,
  `findTaxPeriodTx`, `recordTaxEntriesTx` with a pre-resolved `taxPeriodId`),
  `inventory/costing-fs.ts` (weighted-average, split plan/commit).
  **`ledger-fs.ts` refactored to `planPosting` (reads) / `commitPosting`
  (writes)** — Firestore forbids reads after writes, so every posting flow is
  now two-phase; `postJournal` runs both. `documents/invoices-fs.ts`
  (`createInvoice`, `postInvoice`, `voidInvoice`, `refreshInvoiceStatusTx` —
  incl. COGS for tracked items and per-component tax rows) and
  `documents/payments-fs.ts` (`recordPayment`, `voidPayment`,
  `openDocumentsForParty`). `documents/bills-fs.ts` has only
  `refreshBillStatusTx` so far.
  **Deviation:** create-and-post and edit-a-posted-invoice run as a short
  sequence of single-purpose transactions, not one — a Firestore transaction
  can't re-read what it just wrote, and each step is individually atomic.
- [ ] **Phase 5 — remaining posting flows** (bills, expenses, estimates→invoice
  conversion, credit notes) + **reports** rewritten against
  `accountPeriodBalances` + collection queries + `closeChecklist`; CSV export.
- [ ] **Phase 5b — banking & reconciliation, HR, payroll, recurring, projects,
  budgets, attachments, notifications.**
- [ ] **Phase 6 — rewire call sites**: every `src/app/**/actions.ts`, page and
  `src/server/**` module off `@/lib/db` and onto the repos / `-fs` engines.
- [ ] **Phase 7 — auth** (§5): Firebase Auth, session cookies, guards, MFA.
- [ ] **Phase 8 — platform admin**: plans, subscriptions, audit, regional rates.
- [ ] **Phase 9 — data migration script**: read every table from Neon,
  transform, write to Firestore preserving ids; rebuild `accountPeriodBalances`;
  verify row counts and a trial balance per company matches pre/post.
- [ ] **Phase 10 — cutover**: enable Blaze, deploy App Hosting backend, smoke
  test, move DNS, remove Prisma/`prisma/`, `@prisma/*`, `pg`, `src/lib/db.ts`,
  `src/generated/prisma`, `netlify.toml`, `render.yaml`.

## 8. Rollback

Until Phase 9 removes Prisma, `main` still deploys the Postgres app unchanged.
The Neon snapshot `backup-pre-deploy-2026-09-10-bankrecon`
(`br-shy-tree-avksywin`) predates the pending bank-reconciliation migration.

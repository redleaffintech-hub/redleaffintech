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
- [x] **Phase 5 — remaining document posting flows.**
  `documents/bills-fs.ts` (`createBill`, `approveBill`, `postBill`, `voidBill` —
  incl. inventory receipt costing + ITC split), `expenses-fs.ts`
  (`createExpense`, `postExpense`, `voidExpense`), `credit-notes-fs.ts`
  (`createCreditNote`, `applyCreditNote`, `writeOffInvoice` — negated tax rows),
  `estimates-fs.ts` (`createEstimate`, `setEstimateStatus`,
  `convertEstimateToInvoice`). Same two-phase / multi-transaction shape as
  invoices-fs. `tsc` + `eslint` clean.
- [x] **Phase 5b — core reports.** `reports/ledger-fs.ts` — the shared read
  primitive: `sumsUpTo` / `sumsInRange` / `accountRawBalanceAsOf` combine the
  `accountPeriodBalances` roll-up (whole months, one indexed query) with a
  `journalLines` line-scan for the cutoff's own partial month; a range is
  `sumsUpTo(to, incl) − sumsUpTo(from, excl)`. `reports/financials-fs.ts`
  (trial balance, income statement / P&L, monthly performance, balance sheet,
  cash flow, general ledger, `currentFiscalRange`, `accountBalance`) — section
  classification copied verbatim. `reports/aging-fs.ts` (AR/AP aging with
  as-of-date balances, unapplied receipts + open credit notes, control-account
  reconciliation). Indexes added.
- [x] **Phase 5c — tax reports, dashboard, close checklist, statements.**
  `reports/tax-fs.ts` (`taxSummary`, `taxDetail`, `taxControlReconciliation`,
  `taxPeriodReturn`, `setTaxPeriodStatus` — GL movement from `sumsInRange`, line
  101 straight off the REVENUE accounts). `reports/dashboard-fs.ts`
  (`dashboardData` + `currentTaxPosition`; `bankQueue` / `unpaidRecurring` read
  the not-yet-migrated banking/recurring collections and are simply 0 until
  Phase 5d). `accounting/journals-fs.ts` gains `closeChecklist`.
  `reports/aging-fs.ts` gains `partyStatement`. `getAccountsBySystemKeys` added.
- [x] **Phase 5d — data layer for the remaining collections.**
  `db/banking.ts` (bankAccounts, bankTransactions, bankRules,
  bankReconciliations — deterministic id `{acct}_{yyyy}-{mm}` —,
  bankReconciliationMatches as their own collection), `db/hr.ts` (departments,
  employees, leaveTypes, leaveRequests, leaveBalanceAdjustments +
  `leaveBalanceHours`), `db/payroll.ts` (payRuns, lines embedded),
  `db/supporting.ts` (projects, budgets, recurring, attachments, notifications,
  fiscalCalendarChanges + `dueRecurringTemplates`). `makeDocRepo` gained
  `embedLines` / `touchUpdatedAt` options for models without those columns.
  Indexes added. tsc + eslint clean.
- [x] **Phase 5e — payroll, fiscal-calendar, bank categorise.**
  `payroll/pay-runs-fs.ts` (create / update / delete / post / void — one
  balanced journal, net pay recomputed server-side). `accounting/
  fiscal-calendar-fs.ts` (`planFiscalYearChange` reads-only; `applyFiscalYear
  Change` gathers every read up front then writes the period deletes/creates +
  company update in one transaction; `resolveFiscalYearRange`).
  `banking/categorize-fs.ts` (`categorizeTransaction` → journal with tax,
  `unmatchTransaction` → reverse). Recurring-template *generation* has no
  implementation in the Prisma app (just the model + a dashboard count), so
  nothing to port.
- [x] **Phase 5f — platform data layer.** `db/platform.ts` +
  `makeTopRepo` (a repo over a top-level, non-company-scoped collection):
  `firms` / `firmUsers`, `plans` / `planVersions` (+ `getPublishedPlans`,
  `getPlanByCode`), `subscriptions` (+ `getSubscriptionForCompany`) with
  `subscriptionEvents` / `subscriptionNotes` / `subscriptionCompanies`,
  `regionalTaxRates` (+ `currentRegionalRate`), and the auth substrate —
  `sessions` (by-token lookup, revoke-for-user), `userTokens` (by-hash),
  `authAttempts` (+ `countAuthAttempts` for rate limiting), `platformAuditLogs`.
  Indexes added.
- [x] **Phase 5g — bank import + matching.** `banking/import-fs.ts` (pure
  CSV/OFX parsers re-exported; `importTransactions` — in-memory dup index +
  `BulkWriter`). `banking/matching-fs.ts` (`suggestRule` / `applyRuleToTransaction`,
  `suggestMatches` + `scoreMatch`, `matchTransactionToDocuments` — records the
  payment in its own transaction then flags the bank line —, `detectTransfers` /
  `confirmTransfer`).
- [x] **Phase 5h — monthly bank reconciliation.** `banking/reconcile-fs.ts` —
  `getOrStartReconciliation` (deterministic id `{acct}_{yyyy}-{mm}`, opening
  carried from the prior COMPLETED month), `saveStatementBalances`, `matchSelected`
  / `removeMatch` (the match write is one transaction; the stored balance
  snapshot is refreshed by `persistSummary` *after* it commits — a Firestore
  transaction can't re-read what it wrote), `buildWorkspace` (statement panel vs
  posted bank-ledger panel, reversal pairs excluded via a parent-entry fetch),
  `completeReconciliation` (freezes the month-end report JSON, optimistic
  `version` check, marks statement txns RECONCILED), `reconciliationHistory`.
  Behaviour matches the Prisma version. tsc + eslint clean.
- [ ] **Phase 5i — `reports/exports.ts` (CSV).** Mechanical: swap
  `./financials`→`-fs` etc. and ~6 direct `db.*` reads to repos. Folds into the
  Phase 6 rewire.
- [ ] **Phase 5c — banking & reconciliation, HR, payroll, recurring, projects,
  budgets, attachments, notifications.**
- **Phase 6 — rewire call sites** off `@/lib/db` / `src/generated/prisma` onto
  the repos and `-fs` engines. Auth stays custom (JWT cookie + `sessions/{token}`
  doc) rather than adopting Firebase Auth — the existing bcrypt/MFA/scope/
  rate‑limit design is kept, only its datastore changes. Files with an `-fs`
  twin get their importers repointed; files without one (auth, admin, plans,
  firm, companies, setup, exports) are edited in place.
  - [x] **6a — auth foundation.** `src/server/auth/session.ts` (JWT + cookie
    unchanged; `sessions/{token}`, `updateUser` for lastLoginAt),
    `src/server/auth/context.ts` (`getCurrentUser`, `requireCompany` and the
    tenant/role/module/capability guards on the repos), `db/platform.ts` sessions
    rekeyed to the token. `password.ts` is pure bcrypt — untouched. tsc clean.
  - [x] **6b — company setup + shared server modules.**
    `setup/provision.ts` rewritten: company doc + chart of accounts (+ code
    guards) + effective-dated tax codes (components embedded) + fiscal periods
    + tax periods + default leave types via one `BulkWriter` after the company
    doc exists; `+ createProvincialTaxCodes`. `hr/leave.ts` (default leave
    types, `leaveBalance` / `leaveBalancesForEmployee` on the hr repos).
    `tax/regional-rates.ts` (the 3 DB reads on the `regionalTaxRates` repo;
    templating pure and unchanged). `plans/catalogue.ts` (`loadPublished` /
    `resolveAssignment` on `plans` / `planVersions`; a `toPlanWithChildren`
    adapter so `planShapeFromRow` is untouched). `provision*` keeps a leading
    ignored `_legacyTx` param until `companies/actions.ts` and `admin/clients.ts`
    are rewired (6c/6d). `tsconfig` excludes `prisma` / `scripts` / `src/generated`
    (all deleted at cutover). tsc clean.
  - [x] **6c‑1 — admin auth + subscription families.** `admin/session.ts`
    (ADMIN‑scope `sessions/{token}`, 12h/1h sliding, step‑up), `admin/guard.ts`
    (`getAdminActor` on `getUser`), `admin/rate-limit.ts` (login limiter on
    `failedAuthAttemptsSince` / `clearFailedAuthAttempts` / `recentFailedAuthAttempts`
    added to `db/platform.ts`), `admin/audit.ts` (`recordPlatformAudit`).
    `companies/families.ts` (`subscriptionForCompany`, `companyFamily`,
    `companyLimit`, `attachCompanyToSubscription` — no `SELECT … FOR UPDATE`;
    tolerant shims for the not‑yet‑rewired `companies/actions.ts`).
  - [x] **6c‑2 — admin metrics + administrators.** `admin/metrics.ts`
    (`platformMetrics` — each cross-tenant collection read whole and grouped in
    memory; no client ledger touched). `admin/administrators.ts` (list / count /
    promote / suspend / remove — the "one active admin always remains" guard
    keeps its atomicity via `runTransaction` reading the active-admin query then
    updating; step-up auth unchanged).
  - [x] **6c‑3 — firm workspace.** `firm/portfolio.ts` (`requireFirmAccess` /
    `requireFirmClient` on the accountant memberships; `clientSnapshot` and the
    9-point `closeChecklist` on the repos + the `-fs` reports —
    `checkLedgerIntegrity`, `arAging`/`apAging`, `taxControlReconciliation`,
    uncategorised-holding via `accountRawBalanceAsOf`).
  - [x] **6c‑4 — plan catalogue admin.** `plans/admin.ts` — `listPlansForAdmin` /
    `getPlanForAdmin` (+ `_count` computed from `planId` queries), `createPlan` /
    `updatePlan` (prices/features/modules collapse to three embedded arrays on
    the plan doc — no child tables), `publishPlan` (writes a new `planVersions`
    doc + the `publishedVersionId` pointer), `archivePlan` / `reactivatePlan` /
    `setPlanVisibility` / `reorderPlans` / `deletePlan`. Validation pure.
  - [x] **6c‑5 — user + membership admin.** `admin/users.ts` — `listUsers`
    (all users + memberships fetched and filtered/paginated in memory — no
    Firestore text search), `getUserForAdmin` (renamed from `getUser`; rich
    shape with memberships, subscription status, live sessions), `createUser`,
    `grantMembership` / `changeMembershipRole` / `setMembershipStatus` /
    `removeMembership` (membershipId = `companyId__userId`; the "last active
    PRIMARY" guard re-checked against the company's memberships), `issuePasswordReset`
    (`spendUserTokens` + new token + `revokeSessionsForUser`), `forceSignOut`,
    `updateUserProfile` (moves the `userEmails` guard doc). Both audit trails
    (platform + tenant) preserved.
  - [x] **6c‑6 — client-company admin.** `admin/clients.ts` — `listClients` /
    `listClientsForExport` (companies + subscriptions + companyUsers + users
    joined and filtered/sorted/paged in memory), `getClient`, `createClient`
    (`provisionCompany` then user / membership / seat-override in sequence — no
    cross-collection transaction; an incomplete client is deleted rather than
    rolled back), `updateClient` / `setReadOnly` / `setClientModules`,
    `deleteClient` (**`recursiveDelete` on `companies/{id}`** — Firestore has no
    `onDelete: Cascade` — plus explicit sweeps of the top-level companyUsers /
    subscription / subscriptionCompanies).
  - [x] **6c‑7 — subscription lifecycle.** `admin/subscriptions.ts` —
    `seatsUsed`, `assignPlan` (create-or-update, price snapshotted, clears
    terminal states), `changeStatus` (the `canTransition` state machine;
    scheduled vs immediate cancel), `extendTrial`, `overrideSeats` (refuses to
    drop below current headcount), `setPeriodEnd`, `addNote`, `setProviderRef`.
    Each: write the subscription → `applyAccess` flips `Company.isReadOnly` →
    typed `subscriptionEvents` doc + `platformAuditLogs` row. **Deviation:** the
    three steps run in sequence, not one transaction.

  **`src/server/**` is now entirely on Firestore** — the only remaining
  `@/lib/db` imports are the old Prisma engine files (`ledger.ts`,
  `invoices.ts`, … ) that have `-fs` twins and `reports/exports.ts`; all are
  deleted at cutover.
  - [x] **6d — sales + purchases + expenses.** customers/vendors CRUD, invoice
    /bill/quote/credit-note/receipt/payment list + detail + new + edit pages and
    their actions on `invoicesRepo` / `billsRepo` / `estimatesRepo` /
    `creditNotesRepo` + the `-fs` document engines; list/detail pages fetch all
    docs and filter/sort/paginate in memory; `peekSequence` replaces
    `peekNumber(db,…)`; delete-guard reference counts scan embedded line arrays.
  - [x] **6e — accounting + banking.** chart of accounts (list + reclassify /
    CRUD / activate / delete with a cross-collection reference scan), general
    ledger / trial balance / journal list + detail / fiscal periods /
    opening-balances on `journal-entries` + `fiscal-periods` repos and the `-fs`
    reports; banking review queue / accounts / rules / reconcile pages +
    banking + bank-account actions on the `banking` repos and `categorize-fs` /
    `matching-fs` / `import-fs` / `reconcile-fs`. Adds
    `listEntries` / `findReversalOf` / `listLinesUpTo` / `countLinesForAccount`
    to `journal-entries`; enriches `financials-fs` `generalLedger` rows with the
    journal entry + party names.
  - [x] **6f — tax + reports.** Tax Centre / filing periods / tax codes pages +
    `tax/actions` on `tax-periods` / `tax-codes` / `tax-entries` repos and
    `tax-fs`; tax code creation writes embedded components; period/code roll-ups
    from one `listAllTaxEntries` pass. Report pages repointed to the `*-fs`
    reports; budget-vs-actual reads `budgets` + `balancesInRange`. Adds
    `deleteTaxPeriod` / `listAllTaxEntries` / `listTaxEntriesForPeriod` /
    `listTaxEntriesForJournalEntry`, and a named `StatementSubtotal` export.
  - [x] **6g — company / hr / payroll / inventory / firm.** company profile /
    numbering / fiscal-calendar / users / subscription actions + pages, products
    & services (CRUD + usage/delete guards), multi-company create/archive/
    restore/delete, audit log; HR departments / employees / leave types /
    time-off; payroll pay-runs (list/detail/new/edit + `pay-runs-fs`); inventory
    page + a new self-contained `adjustStock` in `costing-fs`; firm close page +
    action. Adds `deleteCompany` / `listAllCompanies` / `deleteItem` /
    `updateCompany` uses.
  - [x] **6h — admin portal + auth + app shell + api.** regional-tax-rates /
    audit / plans / subscriptions / users / clients / settings / administrators
    pages + actions, admin login + change-password, the customer login flow +
    `api/search`, the `(app)` shell layout, and the shared payment
    list/detail components — all on `platform` / `users` / `company-users` /
    `companies` repos with in-memory filter/sort/paginate. Adds
    `listSessionsForUser` / `revokeOtherSessionsForUser` / `spendAllUserTokens`
    / `listAllUsers`. **No file under `src/app` or `src/components` imports
    `@/lib/db` any more.**
  - [ ] **`reports/exports.ts`** (CSV) — mechanical import-swap to the `-fs`
    reports, folded into Phase 8.
- [x] **Phase 7 — data migration script**: `scripts/migrate-to-firestore.ts`
  (`npm run migrate:firestore -- --dry-run | --yes | --only=…`). Reads all 63
  Prisma models, writes to Firestore preserving cuids (except `companyUsers` /
  `firmUsers` → `${a}__${b}`, `sessions` → token, `subscriptionCompanies` →
  companyId — the deterministic ids the app computes); line children embed onto
  their parent; `accountCodes` / `taxCodeCodes` / `itemCodes` / `userEmails`
  guard docs written alongside; `paymentAllocations` (no `companyId` column)
  attributed via their payment/invoice/bill/creditNote. Rebuilds
  `accountPeriodBalances` from `journalLines` after the import. Idempotent
  (every write is an id-addressed `.set()`); never deletes. Verification pass:
  per-company trial balance PG-vs-FS + per-account match, and row counts for
  invoices/bills/payments/journals/customers/vendors/taxEntries + the top-level
  collections. Dry run against the live Neon DB: 63 tables → **2,694 documents**
  (2 companies, demo data). Live write needs a `redleaf-fintech-e4c4d` service
  account (`GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SERVICE_ACCOUNT`) — set
  at cutover.
- **Phase 8 — cutover**
  - [x] **8a — code cutover (done, buildable).**
    - `reports/exports.ts` (CSV) rewired onto the `-fs` reports + repos.
    - **Deleted** the 19 old Prisma engine modules
      (`accounting/{fiscal-calendar,journals,ledger}`,
      `banking/{import,matching,reconcile}`,
      `documents/{bills,credit-notes,estimates,expenses,invoices,payments,numbering}`,
      `inventory/costing`, `payroll/pay-runs`,
      `reports/{aging,dashboard,financials,tax}`).
    - **Renamed** every `*-fs.ts` → its canonical name (`ledger-fs.ts` →
      `ledger.ts`, `financials-fs.ts` → `financials.ts`, …) and rewrote every
      `@/server/**-fs` / `./x-fs` import across `src/`. `reports/ledger-fs.ts`
      → `reports/ledger.ts`; `banking/categorize-fs.ts` → `banking/categorize.ts`.
      **Kept `tax/engine-fs.ts`** (its twin `tax/engine.ts` is the *pure*
      arithmetic, imported by client components — cannot carry `server-only`).
    - `tax/engine.ts` stripped of its three Prisma-`Tx` helpers (`loadTaxCodes`
      / `findTaxPeriod` / `recordTaxEntries`) — now pure.
    - `banking/import.ts` re-inlines the pure CSV/OFX parsers that lived in the
      deleted twin.
    - `src/middleware.ts` → `src/proxy.ts` (`export function proxy` — Next 16
      native; the Netlify-adapter `middleware` name is gone).
    - Deleted `netlify.toml`, `render.yaml`. `package.json` `build` →
      `next build --webpack` (no `prisma migrate deploy`; App Hosting builds
      without a database connection). `apphosting.yaml` already configured for
      `redleaf-fintech-e4c4d` + ADC + Cloud Secret Manager `SESSION_SECRET`.
    - **No file under `src/`** imports `@/lib/db` any more. Production build
      green.
  - [x] **8a-emulator — full smoke test against a live Firestore emulator.**
    `scripts/smoke-firestore.ts` (`npm run smoke:firestore`, with the emulator
    on :8080) — **67 assertions**: provisioning → invoice post (journal graph +
    `accountPeriodBalances` roll-up + tax entries) → trial balance / income
    statement / balance sheet all balance / A/R aging → receipt + allocation →
    bill approval + post → manual journal + reversal → period close + rejection
    of a post into it → bank CSV import + duplicate detection → estimate →
    convert to invoice → credit note → apply → inventory `adjustStock` → bank
    categorise → delete-guard reference count → dashboard aggregation → final
    whole-company trial balance.

    **Caught and fixed two production-breaking read-after-write bugs** — both
    from porting a Prisma transaction (which has no read/write ordering rule) to
    a Firestore one (which forbids a read after any write):
    1. `refreshInvoiceStatusTx` / `refreshBillStatusTx` did their own `getTx`
       inside the write phase of `recordPayment` / `applyPayment` /
       `voidPayment` / `applyCreditNote` — would have broken **every payment and
       credit-note application**. Both now take the doc fields they need (read
       in the caller's read phase) and are synchronous.
    2. `createCreditNote` (no draft state — create + post in one transaction)
       called `bumpSequenceTx` (a company-doc write) before `planPosting` (a
       company-doc read) — would have broken **every credit-note creation**. Now
       reads the counter in the read phase and writes the increment alongside
       `commitPosting`, matching how `recordPayment` already did it.
  - [ ] **8b — deploy (needs the account owner).** Enable Blaze on
    `redleaf-fintech-e4c4d`; `firebase apphosting:secrets:set SESSION_SECRET`;
    with a service-account key, `npm run migrate:firestore -- --yes` (reads the
    live Neon DB — Prisma + `src/lib/db.ts` + `prisma/schema.prisma` are kept
    for exactly this) and confirm the verification pass is clean; `firebase
    apphosting:backends:create` / push to the connected branch to build & deploy;
    smoke-test sign-in, a posted invoice, a report, a bank import; move DNS.
  - [ ] **8c — final Prisma removal (after 8b succeeds).** Delete
    `scripts/migrate-to-firestore.ts` and the other Prisma-only scripts
    (`verify.ts`, `census.ts`, `backfill-*.ts`, `seed-plans.ts`,
    `create-platform-admin.ts`, `prisma/seed.ts`) or port them to Firestore;
    `src/lib/db.ts`, `prisma/`, `src/generated/prisma`; `@prisma/client`,
    `@prisma/adapter-pg`, `prisma`, `pg`, `@types/pg` from `package.json`;
    `postinstall` and `db:migrate` scripts; the `DATABASE_URL` env.

## 8. Rollback

Until Phase 9 removes Prisma, `main` still deploys the Postgres app unchanged.
The Neon snapshot `backup-pre-deploy-2026-09-10-bankrecon`
(`br-shy-tree-avksywin`) predates the pending bank-reconciliation migration.

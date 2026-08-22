# Red Leaf Accounting

Canadian double-entry cloud accounting, built by **Red Leaf Fintech Inc.**

A full accounting platform — general ledger, sales and purchase cycles, banking
with reconciliation, GST/HST/PST/QST with place-of-supply resolution, financial
reports, and a multi-client workspace for accounting firms — plus the public
marketing site, in one Next.js application.

**Stack:** Next.js 16 (App Router, React 19) · Prisma 7 · PostgreSQL (Neon) ·
Tailwind 4 · `jose` + `bcryptjs` sessions · TypeScript

---

## Quick start

Requires Node 20+ and a PostgreSQL 14+ database (Neon, or any local instance).

```bash
npm install                     # postinstall runs `prisma generate`
cp .env.example .env            # then fill in the values below
npx prisma migrate deploy       # apply migrations
npm run seed                    # demo company with genuinely balanced books
npm run dev                     # http://localhost:3000
```

The marketing site is at `/`; the application lives under `/dashboard`. Anyone
holding a session cookie is bounced from `/` to `/dashboard` by `src/proxy.ts`
(Next 16's renamed middleware).

### Demo logins

`npm run seed` builds two companies. Every password is `demo1234`.

| Email | Role | Sees |
| --- | --- | --- |
| `owner@northbridge.ca` | PRIMARY | Everything, including company settings and tax setup |
| `books@northbridge.ca` | SECONDARY | Day-to-day bookkeeping; **no** tax settings |
| `review@northbridge.ca` | REVIEWER | Read-only |
| `accountant@cedarvale.ca` | ACCOUNTANT | The `/firm` multi-client workspace |

To list these on the sign-in page with the password pre-filled, set
`DEMO_ACCOUNTS=1`. **Never set it in production** — it enumerates every user in
the database, which is why it is off by default.

---

## Environment

See `.env.example` for the annotated template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | **Pooled** connection string. What the app runs on — serverless instances each open their own connections, and the pooler is what keeps a busy moment from exhausting the limit. |
| `DATABASE_URL_UNPOOLED` | yes | **Direct** connection string. Migrations only — see the warning below. |
| `SESSION_SECRET` | yes | Signs session cookies. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for `sitemap.xml` and `robots.txt`. |
| `CONTACT_EMAIL` | no | Published on `/contact`, and the fallback when the form has nowhere to post. |
| `CONTACT_FORWARD_URL` | no | Where `/contact` submissions are POSTed. While unset, the form tells the visitor to email `CONTACT_EMAIL` rather than pretending the message was delivered. |
| `DEMO_ACCOUNTS` | no | `1` lists seeded logins on `/login`. Production: leave unset. |

`vercel env pull` writes to **`.env.local`**, and a stale `.env` may still sit
beside it. `scripts/load-env.ts` loads `.env.local` first for exactly this
reason — CLI scripts that skip it silently target the wrong database.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | `prisma migrate deploy` → `prisma generate` → `next build` |
| `npm run seed` | Demo data, built by calling the real services — if a posting rule is wrong, the seed fails |
| `npm run verify` | Acceptance checks against the live database (see below) |
| `npm run lint` | ESLint. Note that `next build` does **not** run it |

### `npm run verify`

The accounting equivalent of a test suite. It checks, against real data: that
every journal balances, that A = L + E, that the AR / AP / tax subledgers
reconcile to their control accounts, and the tax engine's unit cases. **Run it
after any change to posting, reports, or tax.** Currently 26/26 passing.

---

## Layout

```
src/
  app/
    (marketing)/     public site — home, about, products, pricing,
                     solutions, resources, contact, signup
    (app)/           the application, at /dashboard and its siblings
      accounting/    chart of accounts, journals, periods, trial balance
      sales/         invoices, quotes, credit notes, customers, receipts
      purchases/     bills, vendors, payments
      expenses/      expense capture
      banking/       import, rules, matching, reconciliation
      tax/           codes, filing periods
      reports/       P&L, cash flow, AR/AP aging, tax summary + detail,
                     budget vs actual
      company/       settings, users, audit log, subscription
      firm/          accountant's multi-client workspace
    login/  api/     auth and search endpoints
  server/            all business logic — nothing here is client-reachable
    accounting/      ledger.ts is the posting engine
    documents/       invoices, bills, credit notes, payments, numbering
    banking/         import, matching, reconcile
    tax/             engine.ts
    auth/            context.ts is the tenant boundary
    setup/           provisioning and chart-of-accounts templates
  lib/               money, dates, permissions, plans, place-of-supply
  components/        shared UI; components/shell is the app chrome
prisma/              schema, migrations, seed
scripts/             load-env, verify, release-migrate-lock, brand asset prep
brand/               client-supplied source logos (excluded from deploys)
```

---

## Domain invariants

These are deliberate. Please do not "simplify" them away.

- **No floating point in the accounting path.** Money is integer cents, tax
  rates are `rateMicro` (rate × 1 000 000), quantities are milli-units.
- **Tax rates are never edited in place.** A rate change end-dates the old code
  and creates a replacement. Posted `TaxEntry` rows snapshot the `rateMicro`
  they were computed at, so reprinting an old return cannot silently change it.
- **The `CompanyUser` membership row _is_ the authorisation.** `requireCompany()`
  in `src/server/auth/context.ts` is the only tenant boundary, and a company id
  taken from a URL is never trusted.
- **Fiscal-year start month becomes read-only once anything is posted.**
- **Document addresses are snapshotted onto the document**, not read through the
  customer relation — editing a customer must not rewrite an issued invoice.
- **Place of supply drives sales tax.** The ship-to province filters the line tax
  dropdown. A zero-rated / exempt / out-of-scope code survives a destination
  change (federal, no rate, so the same everywhere); a standard-rated one must be
  the destination's own. See `src/lib/place-of-supply.ts`.

---

## Migrations

> [!WARNING]
> Always run migrations over the direct (unpooled) URL.

`prisma migrate` guards itself with a _session-level_ advisory lock. Run it
through a pooler and PgBouncer returns that server connection to the pool
**without releasing the lock** — it outlives the migration and blocks every
later one, including ones over the direct endpoint, with `P1002: timed out
acquiring the advisory lock`. `prisma.config.ts` already points migrations at
`DATABASE_URL_UNPOOLED`; the app itself keeps using the pooled URL, which is
what serverless wants.

To diagnose a stuck lock, look for `locktype='advisory' AND classid=0 AND
objid=72707369` in `pg_locks`. The fingerprint is a holder with
`application_name='pgbouncer'`, idle, whose `last_query` is from some unrelated
workload. `npx tsx scripts/release-migrate-lock.ts` terminates such a holder —
only if it is idle, and only if it holds that exact lock.

---

## Deployment

Vercel, region `iad1`, with the database on Neon in `us-east-1` — deliberately
the same region, so posting transactions settle in milliseconds. The build runs
`prisma migrate deploy` first, so apply migrations against the target database
beforehand and the deploy step is a no-op.

```bash
npx vercel deploy --prod
```

`.vercelignore` keeps `/brand` **root-anchored on purpose** — a bare `brand`
pattern would also match `public/brand` and ship the site logo-less.

---

## Conventions worth knowing

- **A `"use server"` module may only export async functions**, and `next build`
  does not catch a violation — it fails at _render_ with a blank "A server error
  occurred" page. `export type` is fine, being erased. Audit rule: in any file
  containing `"use server"`, every line starting with `export ` must be
  `export async function` or `export type`.
- **Use `DateField` / `useQueryParams` for any date filter bound to the URL**
  (`src/components/date-field.tsx`, `src/components/shell/use-query-params.ts`),
  never a raw `<input type="date">` on search params. Typing a year fires a
  change event on every intermediate value — 2026 is spelled 0002, 0020, 0202,
  2026 — so a filter that commits on change navigates four times and snaps the
  field back mid-typing.
- **`overflow-x-auto` clips the cross axis too.** It silently swallowed every
  dropdown in the horizontal nav; the nav row wraps instead of scrolling.
- Plans and prices live only in `src/lib/plans.ts`. The prices are placeholders.

## Known gaps

- The `Organization` model (one subscription spanning several companies), a real
  `/signup` → checkout → provisioning flow, `/select-company`, and module
  entitlements are all still to come.
- `/onboarding` is referenced by `src/server/auth/context.ts` but does not
  exist — a user with zero memberships lands on a dead route.
- Not yet built: vendor credit notes from the Sales side, quote → invoice
  conversion, and a sensible default line account on the bill form.
- Observability is thin — the Neon integration only, no error tracking or
  analytics.

---

© Red Leaf Fintech Inc. All rights reserved.

/**
 * Which columns hold client-specific personal data and are encrypted at rest.
 *
 * Deliberately NOT encrypted: names, ids, amounts, dates, province/country and
 * every ledger value. Those drive SQL search, sorting, tax logic and reports,
 * and are not what a leaked database or backup would be mined for. SIN and bank
 * account numbers stay masked + one-way hashed (never stored recoverably); see
 * Employee in schema.prisma.
 *
 * An encrypted column can no longer be filtered or sorted in SQL. The data layer
 * (`encrypted-db.ts`) throws if a query tries, so a forgotten call site fails
 * loudly instead of silently matching nothing.
 *
 * Adding a field here protects NEW writes immediately; run
 * `npx tsx scripts/encrypt-data.ts --apply` to convert the rows already stored.
 */
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  Company: [
    "businessNumber", "gstNumber", "qstNumber", "pstNumber", "bcPstNumber", "mbRstNumber", "skPstNumber",
    "addressLine1", "addressLine2", "city", "postalCode", "phone", "email",
  ],
  Customer: [
    "email", "phone", "website", "addressLine1", "addressLine2", "city", "postalCode",
    "shipToLine1", "shipToLine2", "shipToCity", "shipToPostalCode", "notes",
  ],
  Vendor: ["email", "phone", "addressLine1", "city", "postalCode", "businessNumber", "notes"],
  Contact: ["email", "phone"],
  Employee: [
    "personalEmail", "personalPhone", "addressLine1", "addressLine2", "city", "postalCode",
    "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation",
    "bankInstitutionNumber", "bankTransitNumber", "notes", "terminationNote",
  ],
  // Bill-to / ship-to snapshots copied onto each document when it is issued.
  Invoice: [
    "billToLine1", "billToLine2", "billToCity", "billToPostalCode",
    "shipToLine1", "shipToLine2", "shipToCity", "shipToPostalCode",
  ],
  Estimate: [
    "billToLine1", "billToLine2", "billToCity", "billToPostalCode",
    "shipToLine1", "shipToLine2", "shipToCity", "shipToPostalCode",
  ],
};

/**
 * Where a row's encryption scope (the company whose key protects it) comes from.
 * Company is its own scope; Contact has no companyId and borrows its parent's.
 */
export const SCOPE_FIELD: Record<string, "id" | "companyId" | "parent"> = {
  Company: "id",
  Customer: "companyId",
  Vendor: "companyId",
  Contact: "parent",
  Employee: "companyId",
  Invoice: "companyId",
  Estimate: "companyId",
};

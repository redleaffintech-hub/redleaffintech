import "server-only";

import { makeDocRepo } from "./_doc-repo";
import { converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type {
  BankAccount,
  BankReconciliation,
  BankReconciliationMatch,
  BankRule,
  BankTransaction,
} from "./types";

/**
 * Banking & reconciliation collections (§11). Replaces `db.bankAccount.*`,
 * `db.bankTransaction.*`, `db.bankRule.*`, `db.bankReconciliation.*`,
 * `db.bankReconciliationMatch.*`.
 */

export const bankAccounts = makeDocRepo<BankAccount>(
  "bankAccounts",
  ["openingDate", "lastImportAt", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

export const bankTransactions = makeDocRepo<BankTransaction>(
  "bankTransactions",
  ["date", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

export const bankRules = makeDocRepo<BankRule>("bankRules", ["createdAt"], {
  embedLines: false,
  touchUpdatedAt: false,
});

export const bankReconciliations = makeDocRepo<BankReconciliation>(
  "bankReconciliations",
  ["statementStartDate", "statementEndDate", "completedAt", "lockedAt", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

/** Deterministic id for `@@unique([companyId, bankAccountId, statementYear, statementMonth])`. */
export const reconciliationId = (bankAccountId: string, year: number, month: number) =>
  `${bankAccountId}_${year}-${String(month).padStart(2, "0")}`;

// Matches are queried by reconciliationId / bankAccountId — its own collection.
const { decode: decodeMatch, encode: encodeMatch } = converter<BankReconciliationMatch>([
  "createdAt",
]);
const matchCol = (companyId: string) => sub(companyId, "bankReconciliationMatches");

export async function listReconciliationMatches(
  companyId: string,
  reconciliationId: string,
): Promise<BankReconciliationMatch[]> {
  return mapDocs(
    await matchCol(companyId).where("reconciliationId", "==", reconciliationId).get(),
    decodeMatch,
  );
}

export function createReconciliationMatchTx(
  tx: Tx,
  input: Omit<BankReconciliationMatch, "id" | "createdAt"> & { id?: string },
): BankReconciliationMatch {
  const row = { ...input, id: input.id ?? newId(), createdAt: new Date() } as BankReconciliationMatch;
  tx.set(matchCol(input.companyId).doc(row.id), encodeMatch(row));
  return row;
}

export async function deleteReconciliationMatchesTx(
  tx: Tx,
  companyId: string,
  reconciliationId: string,
): Promise<void> {
  const snap = await tx.get(
    matchCol(companyId).where("reconciliationId", "==", reconciliationId),
  );
  for (const d of snap.docs) tx.delete(d.ref);
}

// ── Convenience queries ─────────────────────────────────────────────────────

export async function listBankTransactions(
  companyId: string,
  opts: { bankAccountId?: string; status?: string; from?: Date; to?: Date } = {},
): Promise<BankTransaction[]> {
  let q: FirebaseFirestore.Query = sub(companyId, "bankTransactions");
  if (opts.bankAccountId) q = q.where("bankAccountId", "==", opts.bankAccountId);
  if (opts.status) q = q.where("status", "==", opts.status);
  q = q.orderBy("date");
  const rows = mapDocs<BankTransaction>(await q.get(), (raw, id) => {
    const d = raw as FirebaseFirestore.DocumentData;
    return {
      ...(d as object),
      id,
      date: (d.date as FirebaseFirestore.Timestamp).toDate(),
      createdAt: (d.createdAt as FirebaseFirestore.Timestamp)?.toDate() ?? new Date(0),
    } as BankTransaction;
  });
  return rows.filter(
    (t) => (!opts.from || t.date >= opts.from) && (!opts.to || t.date <= opts.to),
  );
}

export async function listActiveBankRules(companyId: string): Promise<BankRule[]> {
  return bankRules.list(companyId, {
    where: [["isActive", "==", true]],
    orderBy: "priority",
  });
}

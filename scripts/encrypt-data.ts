/**
 * Encrypts the personal-data columns already stored as plaintext, and re-keys
 * rows to the newest key version after a master-key rotation.
 *
 *   npx tsx scripts/encrypt-data.ts            dry run: counts only, writes nothing
 *   npx tsx scripts/encrypt-data.ts --apply    encrypt plaintext values in place
 *   npx tsx scripts/encrypt-data.ts --apply --rotate
 *                                              also re-encrypt values written with an older key version
 *
 * Idempotent and resumable: values that are already encrypted (at the current
 * version) are skipped, so an interrupted run can simply be started again. Every
 * value is decrypted back and compared before it is written. TAKE A BACKUP FIRST
 * (C:\DbBackups\backup-db.ps1) — and keep DATA_ENCRYPTION_KEYS safe: without it
 * the encrypted values cannot be recovered.
 *
 * Run it with the same DATA_ENCRYPTION_KEYS the deployed app uses. Rows written
 * by the app before the key is deployed stay plaintext and are picked up on the
 * next run; reads accept both forms throughout.
 */
import "./load-env";
import { rawDb } from "../src/lib/db";
import { ENCRYPTED_FIELDS } from "../src/server/security/encrypted-fields";
import {
  currentKeyVersion,
  decryptField,
  encryptedVersion,
  encryptField,
  isEncrypted,
} from "../src/server/security/field-crypto";

const APPLY = process.argv.includes("--apply");
const ROTATE = process.argv.includes("--rotate");
const BATCH = 200;

type Row = Record<string, unknown> & { id: string };
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
  update(args: unknown): Promise<unknown>;
};
const delegateOf = (model: string) => (rawDb as unknown as Record<string, Delegate>)[model[0].toLowerCase() + model.slice(1)];

function scopeOf(model: string, row: Row): string | undefined {
  if (model === "Company") return row.id;
  if (model === "Contact") {
    const c = row.customer as { companyId: string } | null;
    const v = row.vendor as { companyId: string } | null;
    return c?.companyId ?? v?.companyId;
  }
  return row.companyId as string | undefined;
}

async function main() {
  const current = currentKeyVersion();
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}  key version ${current}${ROTATE ? "  (rotate)" : ""}\n`);
  let totalChanged = 0;

  for (const [model, cols] of Object.entries(ENCRYPTED_FIELDS)) {
    const delegate = delegateOf(model);
    const select: Record<string, unknown> = { id: true, ...Object.fromEntries(cols.map((c) => [c, true])) };
    if (model === "Contact") {
      select.customer = { select: { companyId: true } };
      select.vendor = { select: { companyId: true } };
    } else if (model !== "Company") {
      select.companyId = true;
    }

    const perColumn: Record<string, number> = {};
    let rows = 0;
    let rowsChanged = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await delegate.findMany({
        select,
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      for (const row of batch) {
        rows++;
        const scope = scopeOf(model, row);
        const data: Record<string, string> = {};
        for (const col of cols) {
          const value = row[col];
          if (typeof value !== "string" || value === "") continue;
          const purpose = `${model}.${col}`;
          let plain: string;
          if (!isEncrypted(value)) {
            plain = value;
          } else if (ROTATE && (encryptedVersion(value) ?? current) < current) {
            plain = decryptField(value, purpose);
          } else {
            continue;
          }
          if (!scope) throw new Error(`${purpose} row ${row.id}: no company scope, refusing to guess.`);
          const enc = encryptField(plain, scope, purpose);
          if (decryptField(enc, purpose) !== plain) throw new Error(`${purpose} row ${row.id}: round-trip mismatch.`);
          data[col] = enc;
          perColumn[col] = (perColumn[col] ?? 0) + 1;
        }
        if (Object.keys(data).length === 0) continue;
        rowsChanged++;
        if (APPLY) await delegate.update({ where: { id: row.id }, data });
      }
    }

    totalChanged += rowsChanged;
    const detail = Object.entries(perColumn).map(([c, n]) => `${c}×${n}`).join(", ");
    console.log(`${model.padEnd(9)} ${String(rows).padStart(5)} rows scanned, ${String(rowsChanged).padStart(5)} ${APPLY ? "updated" : "would change"}${detail ? `  (${detail})` : ""}`);
  }

  console.log(`\n${totalChanged} row(s) ${APPLY ? "updated" : "would be updated"}.${APPLY ? "" : "  Re-run with --apply to write."}`);
  await rawDb.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

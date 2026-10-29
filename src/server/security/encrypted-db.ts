import "server-only";
import { randomBytes } from "node:crypto";
import { decryptField, encryptField } from "./field-crypto";
import { ENCRYPTED_FIELDS, SCOPE_FIELD } from "./encrypted-fields";

/**
 * Transparent field encryption for the Prisma client (see field-crypto.ts for the
 * scheme and encrypted-fields.ts for the column list).
 *
 * `createEncryptionHandler()` is installed as a `$allOperations` query extension
 * in lib/db.ts, so EVERY read and write — including nested creates/updates and
 * `include`d relations, in or out of a transaction — encrypts on the way in and
 * decrypts on the way out. Application code never handles ciphertext.
 */

type Obj = Record<string, unknown>;
type FieldMeta = { name: string; kind: string; type: string };
export type DataModel = { models: Record<string, { fields: FieldMeta[] }> };
/** The un-extended client, used only for scope lookups (never decrypted). */
type LookupClient = Record<string, { findFirst(args: unknown): Promise<unknown> }>;

const WRITE_OPS = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert",
]);
const LOGICAL = new Set(["AND", "OR", "NOT"]);

class MissingScope extends Error {}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
const each = <T>(v: T | T[], fn: (x: T) => T): T | T[] => (Array.isArray(v) ? v.map(fn) : fn(v));
const cap = (s: string) => s[0].toLowerCase() + s.slice(1);

function fieldOf(dm: DataModel, model: string, name: string): FieldMeta | undefined {
  return dm.models[model]?.fields.find((f) => f.name === name);
}
const isEncryptedCol = (model: string, name: string) => ENCRYPTED_FIELDS[model]?.includes(name) ?? false;

/** Ids are cuid-shaped strings; Company needs its id BEFORE insert because it is its own key scope. */
function newId() {
  return "c" + Date.now().toString(36) + randomBytes(10).toString("hex");
}

// ───────────────────────── query guard ─────────────────────────

function onlyNulls(v: unknown) {
  return v === null || (isObj(v) && Object.values(v).every((x) => x === null));
}

function guardWhere(dm: DataModel, model: string, where: unknown): void {
  if (!isObj(where)) return;
  for (const [key, val] of Object.entries(where)) {
    if (LOGICAL.has(key)) {
      for (const sub of Array.isArray(val) ? val : [val]) guardWhere(dm, model, sub);
      continue;
    }
    const f = fieldOf(dm, model, key);
    if (!f) continue;
    if (f.kind === "object") {
      if (!isObj(val)) continue;
      const rel = ["some", "every", "none", "is", "isNot"].filter((k) => k in val);
      if (rel.length) for (const k of rel) guardWhere(dm, f.type, val[k]);
      else guardWhere(dm, f.type, val);
    } else if (isEncryptedCol(model, key) && !onlyNulls(val)) {
      throw new Error(
        `${model}.${key} is encrypted at rest and cannot be used in a where filter. Filter in application code after reading, or search a plaintext column.`,
      );
    }
  }
}

function guardOrderBy(dm: DataModel, model: string, orderBy: unknown): void {
  for (const item of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    if (!isObj(item)) continue;
    for (const [key, val] of Object.entries(item)) {
      const f = fieldOf(dm, model, key);
      if (!f) continue;
      if (f.kind === "object") guardOrderBy(dm, f.type, val);
      else if (isEncryptedCol(model, key)) {
        throw new Error(`${model}.${key} is encrypted at rest and cannot be used in orderBy.`);
      }
    }
  }
}

function guardArgs(dm: DataModel, model: string, args: unknown): void {
  if (!isObj(args)) return;
  guardWhere(dm, model, args.where);
  guardOrderBy(dm, model, args.orderBy);
  for (const part of [args.select, args.include]) {
    if (!isObj(part)) continue;
    for (const [key, val] of Object.entries(part)) {
      const f = fieldOf(dm, model, key);
      if (f?.kind === "object" && isObj(val)) guardArgs(dm, f.type, val);
    }
  }
}

// ───────────────────────── encrypt (writes) ─────────────────────────

function resolveSync(model: string, data: Obj, inherited: string | undefined): string | undefined {
  if (model === "Company") return typeof data.id === "string" ? data.id : inherited;
  if (typeof data.companyId === "string") return data.companyId;
  const connected = (data.company as Obj | undefined)?.connect as Obj | undefined;
  if (typeof connected?.id === "string") return connected.id;
  return inherited;
}

function encryptRecord(dm: DataModel, model: string, data: unknown, inherited: string | undefined): Obj {
  if (!isObj(data)) return data as Obj;
  const scope = resolveSync(model, data, inherited);
  const out: Obj = { ...data };
  for (const [key, val] of Object.entries(data)) {
    const f = fieldOf(dm, model, key);
    if (!f) continue;
    if (f.kind === "scalar" && isEncryptedCol(model, key)) {
      const wrapped = isObj(val) && "set" in val;
      const plain = wrapped ? (val as Obj).set : val;
      if (typeof plain === "string" && plain !== "") {
        if (!scope) throw new MissingScope();
        const enc = encryptField(plain, scope, `${model}.${key}`);
        out[key] = wrapped ? { ...(val as Obj), set: enc } : enc;
      }
    } else if (f.kind === "object" && isObj(val)) {
      out[key] = encryptRelationOps(dm, f.type, val, scope);
    }
  }
  return out;
}

function encryptRelationOps(dm: DataModel, model: string, ops: Obj, scope: string | undefined): Obj {
  const enc = (d: unknown) => encryptRecord(dm, model, d, scope);
  // `update` / `updateMany` are either `{ where, data }` or (to-one) the data itself.
  const encData = (o: unknown): Obj => (isObj(o) && isObj(o.data) ? { ...o, data: enc(o.data) } : enc(o));
  const out: Obj = { ...ops };
  if (ops.create) out.create = each(ops.create as Obj | Obj[], enc);
  if (isObj(ops.createMany)) out.createMany = { ...ops.createMany, data: each(ops.createMany.data as Obj | Obj[], enc) };
  if (ops.connectOrCreate) {
    out.connectOrCreate = each(ops.connectOrCreate as Obj | Obj[], (o) => ({ ...o, create: enc(o.create) }));
  }
  if (ops.upsert) {
    out.upsert = each(ops.upsert as Obj | Obj[], (o) => ({ ...o, create: enc(o.create), update: encData(o.update) }));
  }
  if (ops.update) out.update = each(ops.update as Obj | Obj[], encData);
  if (ops.updateMany) out.updateMany = each(ops.updateMany as Obj | Obj[], encData);
  return out;
}

async function lookupScope(
  dm: DataModel,
  base: LookupClient,
  model: string,
  where: unknown,
  data?: Obj,
): Promise<string | undefined> {
  if (model === "Company") {
    if (isObj(where) && typeof where.id === "string") return where.id;
  } else if (isObj(where) && typeof where.companyId === "string") {
    return where.companyId;
  }
  const delegate = base[cap(model)];
  if (SCOPE_FIELD[model] === "parent") {
    const parentId = (k: string) => (isObj(data) && typeof data[k] === "string" ? (data[k] as string) : undefined);
    const cid = parentId("customerId");
    const vid = parentId("vendorId");
    if (cid) return ((await base.customer.findFirst({ where: { id: cid }, select: { companyId: true } })) as Obj | null)?.companyId as string | undefined;
    if (vid) return ((await base.vendor.findFirst({ where: { id: vid }, select: { companyId: true } })) as Obj | null)?.companyId as string | undefined;
    if (!delegate || !where) return undefined;
    const row = (await delegate.findFirst({
      where,
      select: { customer: { select: { companyId: true } }, vendor: { select: { companyId: true } } },
    })) as { customer?: { companyId: string } | null; vendor?: { companyId: string } | null } | null;
    return row?.customer?.companyId ?? row?.vendor?.companyId;
  }
  if (!delegate || !where) return undefined;
  const field = model === "Company" ? "id" : "companyId";
  if (!fieldOf(dm, model, field)) return undefined;
  const row = (await delegate.findFirst({ where, select: { [field]: true } })) as Obj | null;
  return row?.[field] as string | undefined;
}

/** Encrypt one record, falling back to a database lookup only when the data alone cannot name the scope. */
async function encryptWithScope(
  dm: DataModel,
  base: LookupClient,
  model: string,
  data: Obj,
  where: unknown,
): Promise<Obj> {
  try {
    return encryptRecord(dm, model, data, undefined);
  } catch (e) {
    if (!(e instanceof MissingScope)) throw e;
  }
  const scope = await lookupScope(dm, base, model, where, data);
  if (!scope) {
    throw new Error(`Cannot encrypt ${model}: no company scope found (is the row missing, or the filter too broad?).`);
  }
  return encryptRecord(dm, model, data, scope);
}

async function prepareWrite(dm: DataModel, base: LookupClient, model: string, op: string, args: Obj): Promise<Obj> {
  switch (op) {
    case "create": {
      let data = args.data as Obj;
      if (model === "Company" && typeof data.id !== "string") data = { ...data, id: newId() };
      return { ...args, data: await encryptWithScope(dm, base, model, data, undefined) };
    }
    case "createMany":
    case "createManyAndReturn": {
      const rows = (Array.isArray(args.data) ? args.data : [args.data]) as Obj[];
      const data = await Promise.all(rows.map((r) => encryptWithScope(dm, base, model, r, undefined)));
      return { ...args, data: Array.isArray(args.data) ? data : data[0] };
    }
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      return { ...args, data: await encryptWithScope(dm, base, model, args.data as Obj, args.where) };
    case "upsert": {
      const create = args.create as Obj;
      const scope = resolveSync(model, create, undefined) ?? (await lookupScope(dm, base, model, args.where, create));
      if (!scope && (isEncryptedAny(dm, model, create) || isEncryptedAny(dm, model, args.update as Obj))) {
        throw new Error(`Cannot encrypt ${model} upsert: no company scope found.`);
      }
      return {
        ...args,
        create: encryptRecord(dm, model, create, scope),
        update: encryptRecord(dm, model, args.update, scope),
      };
    }
    default:
      return args;
  }
}

function isEncryptedAny(dm: DataModel, model: string, data: Obj): boolean {
  try {
    encryptRecord(dm, model, data, undefined);
    return false;
  } catch (e) {
    return e instanceof MissingScope;
  }
}

// ───────────────────────── decrypt (reads) ─────────────────────────

export function decryptResult(dm: DataModel, model: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) decryptResult(dm, model, v);
    return;
  }
  if (!isObj(value)) return;
  for (const [key, val] of Object.entries(value)) {
    const f = fieldOf(dm, model, key);
    if (!f) continue;
    if (f.kind === "scalar") {
      if (typeof val === "string" && isEncryptedCol(model, key)) value[key] = decryptField(val, `${model}.${key}`);
    } else if (f.kind === "object" && val) {
      decryptResult(dm, f.type, val);
    }
  }
}

// ───────────────────────── public ─────────────────────────

export function createEncryptionHandler(dm: DataModel, base: unknown) {
  if (!dm?.models || Object.keys(dm.models).length === 0) {
    // Refuse to run silently unencrypted if Prisma ever stops exposing its data model.
    throw new Error("Prisma runtime data model unavailable; field encryption cannot be installed.");
  }
  const lookup = base as LookupClient;
  return async function handler(p: {
    model?: string;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) {
    const { model, operation, args, query } = p;
    if (!model) return query(args);
    guardArgs(dm, model, args);
    const finalArgs = WRITE_OPS.has(operation) && isObj(args) ? await prepareWrite(dm, lookup, model, operation, args) : args;
    const result = await query(finalArgs);
    if (result && typeof result === "object") decryptResult(dm, model, result);
    return result;
  };
}

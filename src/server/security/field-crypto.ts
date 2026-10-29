import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Field-level encryption for client-specific personal data stored in Postgres.
 *
 * AES-256-GCM with a separate key per scope (a company, or a firm), derived from
 * a master key with HKDF — so one company's key cannot open another company's
 * data, and the master key itself never encrypts anything directly.
 *
 * Stored form:   enc:v<keyVersion>:<scope>:<iv>:<ciphertext||tag>   (base64url)
 *
 *  - The scope id travels WITH the value so a decrypt never needs to know which
 *    row or tenant it came from (nested includes, raw backfills, rotations).
 *  - The model + column name is bound in as GCM additional data, so a ciphertext
 *    copied into a different column fails authentication instead of decrypting.
 *  - The key version lets the master key be rotated: new writes use the highest
 *    version, old values still decrypt until `scripts/encrypt-data.ts --rotate`.
 *
 * Keys come from DATA_ENCRYPTION_KEYS = "1:<base64 32 bytes>[,2:<…>]". Generate
 * one with:  node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"
 *
 * LOSING THE MASTER KEY MAKES THE ENCRYPTED COLUMNS UNRECOVERABLE. Keep a copy
 * outside this machine and outside the database backups.
 */

const PREFIX = "enc:v";
const SCOPE_RE = /^[A-Za-z0-9_-]+$/;

type Keyring = { current: number; masters: Map<number, Buffer> };

let keyring: Keyring | null = null;
const derived = new Map<string, Buffer>();

function loadKeyring(): Keyring {
  if (keyring) return keyring;
  const raw = process.env.DATA_ENCRYPTION_KEYS?.trim();
  if (!raw) {
    throw new Error(
      "DATA_ENCRYPTION_KEYS is not set. Client data is encrypted at rest and cannot be read or written without it.",
    );
  }
  const masters = new Map<number, Buffer>();
  for (const part of raw.split(",")) {
    const [v, b64] = part.trim().split(":");
    const version = Number(v);
    const key = Buffer.from(b64 ?? "", "base64");
    if (!Number.isInteger(version) || version < 1 || key.length !== 32) {
      throw new Error("DATA_ENCRYPTION_KEYS must be comma-separated '<version>:<base64 of 32 bytes>' entries.");
    }
    masters.set(version, key);
  }
  keyring = { current: Math.max(...masters.keys()), masters };
  return keyring;
}

function scopeKey(version: number, scope: string): Buffer {
  const id = `${version}:${scope}`;
  let key = derived.get(id);
  if (!key) {
    const master = loadKeyring().masters.get(version);
    if (!master) throw new Error(`No master key for encryption key version ${version} (DATA_ENCRYPTION_KEYS).`);
    key = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `redleaf/field-encryption/scope:${scope}`, 32));
    derived.set(id, key);
  }
  return key;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Key version a stored value was written with, or null for plaintext. */
export function encryptedVersion(value: string): number | null {
  if (!isEncrypted(value)) return null;
  const v = Number(value.slice(PREFIX.length).split(":")[0]);
  return Number.isInteger(v) ? v : null;
}

export function currentKeyVersion(): number {
  return loadKeyring().current;
}

/** `purpose` is "Model.column"; it must be the same at decrypt time. */
export function encryptField(plaintext: string, scope: string, purpose: string): string {
  if (!SCOPE_RE.test(scope)) throw new Error("Invalid encryption scope.");
  const version = loadKeyring().current;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scopeKey(version, scope), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${version}:${scope}:${iv.toString("base64url")}:${body.toString("base64url")}`;
}

/** Plaintext passes through untouched, so rows can be migrated gradually. */
export function decryptField(value: string, purpose: string): string {
  if (!isEncrypted(value)) return value;
  // enc : v<N> : scope : iv : body
  const [, vTag, scope, ivB64, bodyB64] = value.split(":");
  const v = Number(vTag?.slice(1));
  if (!Number.isInteger(v) || !scope || !ivB64 || !bodyB64) throw new Error(`Malformed encrypted value for ${purpose}.`);
  const body = Buffer.from(bodyB64, "base64url");
  if (body.length < 16) throw new Error(`Malformed encrypted value for ${purpose}.`);
  const decipher = createDecipheriv("aes-256-gcm", scopeKey(v, scope), Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`Could not decrypt ${purpose}: wrong key or tampered data.`);
  }
}

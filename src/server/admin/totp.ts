/**
 * TOTP (RFC 6238) for platform-administrator MFA.
 *
 * Implemented directly on node:crypto rather than pulled in as a dependency —
 * it is forty lines of HMAC and a base32 codec, and the accounting path already
 * refuses to take dependencies it can write exactly.
 *
 * Compatible with Google Authenticator, 1Password, Authy and anything else that
 * speaks `otpauth://totp/` — SHA-1, 6 digits, 30-second step, which is what
 * those clients assume when the URI omits the parameters.
 */

import "server-only";
import { createHmac, randomBytes } from "crypto";

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** How many steps either side of now are accepted, for clock drift. */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("The authenticator secret is not valid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 bytes — the SHA-1 block size every authenticator app expects. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForStep(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verify a submitted code against the shared secret.
 *
 * The comparison walks every candidate step rather than returning on the first
 * match, so the time taken does not reveal which step succeeded.
 */
export function verifyTotp(secretBase32: string, submitted: string, now: Date = new Date()): boolean {
  const code = submitted.replace(/\D/g, "");
  if (code.length !== DIGITS) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  const step = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
  let matched = false;
  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset += 1) {
    if (codeForStep(secret, step + offset) === code) matched = true;
  }
  return matched;
}

/** The URI an authenticator app scans or accepts as pasted text. */
export function otpauthUri(secretBase32: string, accountEmail: string, issuer = "Red Leaf Fintech"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Grouped into fours — the form people can actually type from a screen. */
export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}

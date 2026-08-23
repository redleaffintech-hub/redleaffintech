/**
 * Small cryptographic helpers for the platform-admin portal.
 *
 * Two rules shape everything here:
 *
 *   * A secret that only needs to be *checked* is stored as a one-way hash — a
 *     database read must not be replayable as a valid invitation or reset link.
 *   * A secret that must be *recovered* (the TOTP shared secret, which has to be
 *     re-derived on every code check) is encrypted with AES-256-GCM rather than
 *     stored in the clear, so a leaked table dump is not a set of working
 *     authenticator enrolments.
 *
 * The key is derived from SESSION_SECRET. Rotating that secret therefore
 * invalidates every MFA enrolment as well as every session — which is the
 * correct blast radius for a compromised signing key, but is worth knowing
 * before rotating one casually.
 */

import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

function keyMaterial(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET must be set in production — admin secrets cannot be encrypted with the development fallback.",
      );
    }
    return "redleaf-development-secret-change-me";
  }
  return value;
}

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (!cachedKey) {
    // A fixed salt is acceptable here because the input is already a
    // high-entropy secret, not a user-chosen password; the scrypt pass exists
    // to widen a short secret to 32 bytes, not to resist a dictionary attack.
    cachedKey = scryptSync(keyMaterial(), "redleaf-admin-secretbox", 32);
  }
  return cachedKey;
}

/** AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Returns null rather than throwing: a secret that will not decrypt is simply not usable. */
export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The stored form of an invitation or password-reset token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 bytes of entropy, URL-safe. This is the half that is emailed and never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Length-safe constant-time comparison of two ASCII strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Compare against itself so the timing profile does not leak the length,
    // then fail regardless.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_SYMBOLS = "!@#$%^&*-_=+";

/**
 * A temporary password for an administrator-created account.
 *
 * Shown once, hashed before storage, and paired with `mustChangePassword` so it
 * cannot outlive the first sign-in. Ambiguous glyphs (0/O, 1/l/I) are omitted
 * because this string gets read aloud or copied by hand.
 */
export function generateTemporaryPassword(length = 16): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length - 2; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  // Guarantee the generated value satisfies the same policy users are held to.
  out += PASSWORD_SYMBOLS[bytes[bytes.length - 1] % PASSWORD_SYMBOLS.length];
  out += String(bytes[bytes.length - 2] % 10);
  return out;
}

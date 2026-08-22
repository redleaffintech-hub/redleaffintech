import bcrypt from "bcryptjs";

/** Kept separate from session.ts so scripts can hash without pulling in next/headers. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

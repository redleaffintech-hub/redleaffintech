import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 connects through a driver adapter (§29 — PostgreSQL).
 *
 * On Vercel every request may land on a cold serverless instance, so the pool
 * is kept deliberately small: a large pool per instance multiplied by the
 * number of instances is how a serverless app exhausts a Postgres connection
 * limit. Neon's pooled connection string does the real multiplexing.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and point it at your database.");
  }
  if (!/^postgres(ql)?:\/\//.test(connectionString)) {
    // A leftover `file:./dev.db` from the SQLite build reaches the pg driver as
    // a hostname and fails with an unrelated DNS error. Say what is wrong here.
    throw new Error(`DATABASE_URL must be a postgresql:// connection string (§29); got "${connectionString.split(":")[0]}:…".`);
  }

  const adapter = new PrismaPg({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // A ceiling, not an expected duration. Deployed, the function and the Neon
    // database are both in us-east-1 and a posting transaction settles in
    // milliseconds. Run from a developer's laptop on another continent the same
    // transaction is dozens of round trips and blows straight past Prisma's 5 s
    // interactive default — which is what seeding does.
    transactionOptions: { timeout: 20_000, maxWait: 10_000 },
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** The interactive-transaction client type, for functions that must run inside a tx. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

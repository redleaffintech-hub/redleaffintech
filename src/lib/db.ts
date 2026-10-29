import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createEncryptionHandler, type DataModel } from "@/server/security/encrypted-db";

/**
 * Prisma 7 connects through a driver adapter (§29 — PostgreSQL).
 *
 * On Vercel every request may land on a cold serverless instance, so the pool
 * is kept deliberately small: a large pool per instance multiplied by the
 * number of instances is how a serverless app exhausts a Postgres connection
 * limit. Neon's pooled connection string does the real multiplexing.
 */
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

/**
 * `rawDb` is the plain client: it sees ciphertext exactly as stored. Only the
 * encryption backfill/rotation script should touch it. Everything else uses `db`,
 * which encrypts client personal data on write and decrypts on read (§ field
 * encryption — see src/server/security).
 */
function createEncryptedClient() {
  const raw = createClient();
  const dm = (raw as unknown as { _runtimeDataModel: DataModel })._runtimeDataModel;
  const handler = createEncryptionHandler(dm, raw);
  const extended = raw.$extends({
    name: "field-encryption",
    query: { $allModels: { $allOperations: handler as never } },
  });
  return { raw, extended };
}

const globalForClients = globalThis as unknown as { clients?: ReturnType<typeof createEncryptedClient> };
const clients = globalForClients.clients ?? createEncryptedClient();
if (process.env.NODE_ENV !== "production") globalForClients.clients = clients;

// The extension changes no model types, so `db` is typed as the plain client —
// that keeps `Tx` (and every helper that takes one) assignable from a transaction.
export const db = clients.extended as unknown as PrismaClient;
export const rawDb: PrismaClient = clients.raw;

/** The interactive-transaction client type, for functions that must run inside a tx. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

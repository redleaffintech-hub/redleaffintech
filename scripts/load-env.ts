/**
 * Loads .env for scripts run under bare tsx (seed, verify). Next.js does this
 * itself; the Prisma/tsx CLIs do not.
 *
 * Import this for its side effect, and import it BEFORE anything that reads
 * process.env at module scope (src/lib/db.ts builds the Prisma client on
 * import). A bare `config(...)` call in the consuming file is not equivalent:
 * ES module imports are hoisted above statements, so db.ts would be evaluated
 * before the call ran.
 *
 * Order matters as much as timing. `vercel env pull` writes the real Neon
 * DATABASE_URL to .env.local, while .env still carries the dead pre-Postgres
 * `file:./dev.db`. dotenv keeps the FIRST value it sees, so .env.local is
 * listed first — the same precedence Next.js applies.
 */

import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

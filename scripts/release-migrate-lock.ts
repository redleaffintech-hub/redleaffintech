/**
 * Releases Prisma's leaked migration advisory lock (72707369).
 *
 * A `prisma migrate` run through Neon's POOLED endpoint takes a session-level
 * pg_advisory_lock; PgBouncer then returns that server connection to the pool
 * without releasing it, so the lock outlives the migration and blocks every
 * later one. Terminating the holding backend is the only way to clear it short
 * of restarting the Neon compute.
 *
 * Deliberately narrow: it only terminates backends that (a) hold that exact
 * advisory lock and (b) are idle, so it cannot kill in-flight work.
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"] });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("no connection string");

const client = new Client({ connectionString: url });

const HOLDERS = `
  SELECT l.pid, a.state, a.application_name
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory'
    AND l.classid = 0 AND l.objid = 72707369 AND l.objsubid = 1
    AND a.pid <> pg_backend_pid()
`;

const main = async () => {
  await client.connect();

  const { rows } = await client.query(HOLDERS);
  if (rows.length === 0) {
    console.log("migrate lock is free — nothing to do");
    await client.end();
    return;
  }

  for (const row of rows) {
    if (row.state !== "idle") {
      console.log(`pid ${row.pid} holds the lock but is ${row.state} — leaving it alone`);
      continue;
    }
    const res = await client.query("SELECT pg_terminate_backend($1) AS ok", [row.pid]);
    console.log(`terminated pid ${row.pid} (${row.application_name}): ${res.rows[0].ok}`);
  }

  const after = await client.query(HOLDERS);
  console.log(`holders remaining: ${after.rowCount}`);

  // Prove the lock is actually takeable now, then hand it straight back.
  const probe = await client.query("SELECT pg_try_advisory_lock(72707369) AS got");
  console.log(`can acquire migrate lock: ${probe.rows[0].got}`);
  if (probe.rows[0].got) await client.query("SELECT pg_advisory_unlock(72707369)");

  await client.end();
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

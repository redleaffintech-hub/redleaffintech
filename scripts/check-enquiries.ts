/** Lists saved contact enquiries (local DB by default). */
import "./load-env";
import { rawDb } from "../src/lib/db";

async function main() {
  const rows = await rawDb.contactEnquiry.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  for (const r of rows) console.log(r.createdAt.toISOString(), r.status, r.name, r.email, "|", r.message);
  console.log(`${rows.length} enquiry row(s)`);
  await rawDb.$disconnect();
}
main();

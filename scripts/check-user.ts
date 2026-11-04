import "./load-env";
import { rawDb } from "../src/lib/db";

async function main() {
  const users = await rawDb.user.findMany({
    where: { email: { contains: "malhi", mode: "insensitive" } },
    select: { id: true, email: true, name: true, mustChangePassword: true, passwordChangedAt: true, lastLoginAt: true, createdAt: true },
  });
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}
main();

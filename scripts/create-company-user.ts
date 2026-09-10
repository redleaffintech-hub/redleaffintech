/**
 * Create an ordinary end-user login and attach it to a company.
 *
 *   npm run user:create -- --email you@company.ca --name "Your Name" [--company <id>] [--role PRIMARY]
 *
 * Sibling of `admin:create` (that one is for platform staff). If --company is
 * omitted and there is exactly one company, it uses that. A generated password
 * is printed once unless --use-env-password reads PLATFORM_ADMIN_PASSWORD's
 * sibling USER_PASSWORD.
 *
 * Firestore creds: GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT,
 * or FIRESTORE_EMULATOR_HOST for the emulator.
 */

import "./load-env";
import { hashPassword } from "../src/server/auth/password";
import { generateTemporaryPassword } from "../src/server/admin/crypto";
import { getUserByEmail, createUser, updateUser } from "../src/server/db/users";
import { upsertMembership } from "../src/server/db/company-users";
import { listAllCompanies, getCompany } from "../src/server/db/companies";

const ROLES = ["PRIMARY", "SECONDARY", "REVIEWER", "ACCOUNTANT"] as const;
type Role = (typeof ROLES)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}
function fail(m: string): never {
  console.error(`\n  ✗ ${m}\n`);
  process.exit(1);
}

async function main() {
  const email = arg("--email")?.trim().toLowerCase();
  const name = arg("--name")?.trim();
  const role = (arg("--role") ?? "PRIMARY").toUpperCase() as Role;
  const useEnvPassword = process.argv.includes("--use-env-password");

  if (!email || !email.includes("@")) fail('An email is required:  --email you@company.ca');
  if (!ROLES.includes(role)) fail(`--role must be one of ${ROLES.join(", ")}`);

  let companyId = arg("--company");
  if (!companyId) {
    const companies = await listAllCompanies();
    if (companies.length === 0) fail("No company exists yet — provision one first.");
    if (companies.length > 1) {
      fail(
        "More than one company exists — pass --company <id>:\n" +
          companies.map((c) => `      ${c.id}  ${c.name}`).join("\n"),
      );
    }
    companyId = companies[0].id;
  }
  const company = await getCompany(companyId);
  if (!company) fail(`Company ${companyId} not found.`);

  const existing = await getUserByEmail(email);
  let userId: string;
  let passwordLine = "";

  if (existing) {
    userId = existing.id;
    console.log(`\n  · ${email} already exists — attaching to ${company!.name}.`);
  } else {
    if (!name) fail('A name is required for a new account:  --name "Your Name"');
    const envPassword = process.env.USER_PASSWORD;
    if (useEnvPassword && !envPassword) fail("--use-env-password set but USER_PASSWORD is empty.");
    const password = useEnvPassword ? envPassword! : generateTemporaryPassword(16);
    const user = await createUser({
      email,
      name: name!,
      passwordHash: await hashPassword(password),
      mustChangePassword: !useEnvPassword,
    });
    userId = user.id;
    if (!useEnvPassword) passwordLine = password;
  }

  await upsertMembership({ companyId: companyId!, userId, role, status: "ACTIVE", acceptedAt: new Date() });
  await updateUser(userId, { activeCompanyId: companyId! });

  console.log(`\n  ✓ ${email} is a ${role} on ${company!.name} (${companyId}).`);
  if (passwordLine) {
    console.log("\n    Temporary password (shown once — stored only as a bcrypt hash):\n");
    console.log(`        ${passwordLine}\n`);
    console.log("    Sign in at /login. You will be asked to set a new password.\n");
  } else if (existing) {
    console.log("    Their existing password is unchanged.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

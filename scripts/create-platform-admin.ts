/**
 * Bootstrap the first platform administrator.
 * `npm run admin:create -- --email you@redleaffintech.com --name "Your Name"`
 *
 * This is the *only* way platform access comes into existence from nothing.
 * There is deliberately no public "make me an admin" endpoint and no seeded
 * super-user with a known password: the first administrator is created by
 * someone who already has credentials for the deployment (a service-account
 * key for Firestore), which is the only credential that cannot be phished.
 *
 * Safety rails:
 *
 *   * Refuses to run if an active platform administrator already exists, unless
 *     `--force` is passed. Bootstrapping is a one-time act; after that,
 *     administrators are appointed from inside the portal, where the change is
 *     audited and requires step-up authentication.
 *   * Never accepts a password on the command line by default — a generated one
 *     is printed once and paired with `mustChangePassword`, so it cannot
 *     survive first sign-in. Shell history is not a password vault.
 *   * An existing user is promoted rather than duplicated, and their password is
 *     left completely alone.
 *
 * Needs Firestore credentials: on a workstation, GOOGLE_APPLICATION_CREDENTIALS
 * or FIREBASE_SERVICE_ACCOUNT; against the emulator, FIRESTORE_EMULATOR_HOST.
 */

import "./load-env"; // must precede any import that reads process.env
import { hashPassword } from "../src/server/auth/password";
import { generateTemporaryPassword } from "../src/server/admin/crypto";
import { listAllUsers, getUserByEmail, createUser, updateUser } from "../src/server/db/users";
import { recordPlatformAudit } from "../src/server/db/platform";

interface Args {
  email?: string;
  name?: string;
  force: boolean;
  /** Read a password from PLATFORM_ADMIN_PASSWORD instead of generating one. */
  useEnvPassword: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, useEnvPassword: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") args.force = true;
    else if (token === "--use-env-password") args.useEnvPassword = true;
    else if (token === "--email") args.email = argv[++index];
    else if (token === "--name") args.name = argv[++index];
    else if (token.startsWith("--email=")) args.email = token.slice(8);
    else if (token.startsWith("--name=")) args.name = token.slice(7);
  }
  args.email = args.email ?? process.env.PLATFORM_ADMIN_EMAIL;
  args.name = args.name ?? process.env.PLATFORM_ADMIN_NAME;
  return args;
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    fail(
      'An email is required.\n    npm run admin:create -- --email you@redleaffintech.com --name "Your Name"\n    (or set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_NAME)',
    );
  }

  const allUsers = await listAllUsers();
  const existingAdmins = allUsers.filter(
    (u) => u.isPlatformAdmin && !u.platformAdminSuspendedAt,
  ).length;
  if (existingAdmins > 0 && !args.force) {
    fail(
      `${existingAdmins} active platform administrator${existingAdmins === 1 ? "" : "s"} already ${existingAdmins === 1 ? "exists" : "exist"}.\n` +
        "    Appoint further administrators from /admin/administrators, where the change is audited.\n" +
        "    Pass --force only to recover from being locked out.",
    );
  }

  const existingUser = await getUserByEmail(email);

  if (existingUser) {
    await updateUser(existingUser.id, {
      isPlatformAdmin: true,
      platformAdminSince: new Date(),
      platformAdminSuspendedAt: null,
    });

    await recordPlatformAudit({
      actorUserId: null,
      actorEmail: "cli:create-platform-admin",
      action: "ADMIN_PROMOTED",
      entityType: "User",
      entityId: existingUser.id,
      summary: `${email} granted platform administrator via bootstrap CLI`,
      reason: args.force ? "Bootstrap run with --force" : "First platform administrator",
      beforeJson: null,
      afterJson: null,
      ipAddress: null,
      userAgent: null,
      requestId: null,
    });

    console.log(`\n  ✓ ${email} is now a platform administrator.`);
    console.log("    Their existing password is unchanged — sign in at /admin/login.\n");
    return;
  }

  const name = args.name?.trim();
  if (!name) fail('A name is required when creating a new account: --name "Your Name"');

  const envPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  if (args.useEnvPassword && !envPassword) {
    fail("--use-env-password was passed but PLATFORM_ADMIN_PASSWORD is not set.");
  }
  const password = args.useEnvPassword ? envPassword! : generateTemporaryPassword(20);
  if (password.length < 12) fail("PLATFORM_ADMIN_PASSWORD must be at least 12 characters.");

  const user = await createUser({
    email,
    name,
    passwordHash: await hashPassword(password),
    isPlatformAdmin: true,
    // Even a password the operator chose themselves has been through a shell
    // and an environment variable. It is a way in, not a credential to keep.
    mustChangePassword: true,
  });
  await updateUser(user.id, {
    platformAdminSince: new Date(),
    passwordChangedAt: new Date(),
  });

  await recordPlatformAudit({
    actorUserId: null,
    actorEmail: "cli:create-platform-admin",
    action: "ADMIN_PROMOTED",
    entityType: "User",
    entityId: user.id,
    summary: `${email} created as the first platform administrator via bootstrap CLI`,
    reason: args.force ? "Bootstrap run with --force" : "First platform administrator",
    beforeJson: null,
    afterJson: null,
    ipAddress: null,
    userAgent: null,
    requestId: null,
  });

  console.log(`\n  ✓ Platform administrator created: ${email}`);
  if (!args.useEnvPassword) {
    console.log("\n    Temporary password (shown once — it is stored only as a bcrypt hash):\n");
    console.log(`        ${password}\n`);
  }
  console.log("    Sign in at /admin/login. You will be required to set a new password immediately.");
  console.log("    Enrol MFA from /admin/settings straight afterwards.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

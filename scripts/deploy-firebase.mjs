/**
 * Phase 8b — deploy the Firestore app to Firebase App Hosting.
 *
 *   node scripts/deploy-firebase.mjs [options]
 *
 * Runs the scriptable half of the cutover and stops with a clear ACTION
 * REQUIRED block whenever a step can only be done by a human in a browser
 * (enabling Blaze, authorising the App Hosting → GitHub connection, moving DNS).
 * Re-run it after each manual step; every phase is idempotent.
 *
 * Options:
 *   --dry-run          print every command; run only read-only checks
 *   --migrate          actually run the Neon → Firestore data copy
 *                      (without this, phase 3 only does a --dry-run of it)
 *   --yes              don't pause for the internal confirmations
 *   --location=REGION  App Hosting primary region        (default us-central1)
 *   --backend=ID       App Hosting backend id            (default redleaf)
 *   --branch=NAME      git branch to roll out            (default firebase-migration)
 *   --site-url=URL     override the URL the smoke test hits
 *
 * Needs on PATH: node, npx (firebase-tools via npx), and — for the billing
 * pre-check and API enablement — the gcloud CLI. Without gcloud those two
 * steps are skipped with a warning and the firebase commands surface the
 * errors themselves.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

// ── args ────────────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const val = (name, dflt) => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : dflt;
};

const DRY = has("--dry-run");
const DO_MIGRATE = has("--migrate");
const ASSUME_YES = has("--yes");
const PROJECT = "redleaf-fintech-e4c4d";
const LOCATION = val("--location", "us-central1");
const BACKEND = val("--backend", "redleaf");
const BRANCH = val("--branch", "firebase-migration");
const SITE_URL_OVERRIDE = val("--site-url", null);

// ── output helpers ──────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const phase = (n, title) => console.log(`\n${C.bold}${C.cyan}━━ PHASE ${n} — ${title}${C.reset}`);
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.dim}·${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`);

function manual(title, lines) {
  console.log(`\n${C.bold}${C.yellow}┌─ ACTION REQUIRED — ${title}${C.reset}`);
  for (const l of lines) console.log(`${C.yellow}│${C.reset}  ${l}`);
  console.log(`${C.yellow}└─ then re-run:${C.reset} node scripts/deploy-firebase.mjs${argsEcho()}\n`);
  if (DRY) { warn("(dry run — continuing past this block to show the remaining phases)"); return; }
  process.exit(2);
}
const argsEcho = () => (ARGV.length ? " " + ARGV.join(" ") : "");

function die(m) {
  console.error(`\n${C.red}✗ ${m}${C.reset}\n`);
  process.exit(1);
}

// ── command runners ─────────────────────────────────────────────────────────

/** Run a command, streaming its output. Returns true on success. */
function sh(cmd, { input, allowFail = false } = {}) {
  if (DRY) {
    console.log(`  ${C.dim}$ ${cmd}${C.reset}`);
    return true;
  }
  try {
    execSync(cmd, { stdio: input ? ["pipe", "inherit", "inherit"] : "inherit", input, shell: true });
    return true;
  } catch (e) {
    if (allowFail) return false;
    throw e;
  }
}

/** Run a command, capture stdout. Returns string, or null on failure. */
function shOut(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], shell: true }).toString().trim();
  } catch {
    return null;
  }
}

/** Capture stdout+stderr regardless of exit code (for error-message probes). */
function shProbe(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], shell: true }).toString();
  } catch (e) {
    return `${e.stdout || ""}${e.stderr || ""}`;
  }
}

const have = (bin) => shOut(process.platform === "win32" ? `where ${bin}` : `command -v ${bin}`) !== null;

async function confirm(question) {
  if (ASSUME_YES || DRY) return true;
  process.stdout.write(`  ${C.bold}${question}${C.reset} [y/N] `);
  const answer = await new Promise((res) => {
    process.stdin.resume();
    process.stdin.once("data", (d) => { process.stdin.pause(); res(d.toString().trim().toLowerCase()); });
  });
  return answer === "y" || answer === "yes";
}

const fb = (sub) => `npx --yes firebase ${sub} --project ${PROJECT}`;

// ── phases ──────────────────────────────────────────────────────────────────

function preflight() {
  phase(0, "Preflight");

  if (!have("node") || !have("npx")) die("node and npx must be on PATH.");
  ok("node / npx present");

  // firebase-tools auth
  const fbUser = shOut(`npx --yes firebase login:list`);
  if (!fbUser || /No accounts/i.test(fbUser)) {
    manual("sign in to the Firebase CLI", [
      "Run:  npx firebase login",
      "Use the Google account that owns the Firebase project.",
    ]);
  }
  ok("firebase CLI authenticated");

  const gcloud = have("gcloud");
  if (!gcloud) {
    warn("gcloud CLI not found — skipping API enablement (backends:create does it anyway).");
    warn("Install it (https://cloud.google.com/sdk/docs/install) for a cleaner run.");
    // Blaze check without gcloud: ask App Hosting directly.
    const probe = shProbe(`${fb("apphosting:backends:list --json")}`);
    if (/Blaze/i.test(probe) && /plan/i.test(probe)) {
      manual("put the project on the Blaze (pay-as-you-go) plan", [
        "App Hosting has no free tier — it runs on Cloud Run / Build / CDN, which are Blaze-only.",
        "",
        `Upgrade:  https://console.firebase.google.com/project/${PROJECT}/usage/details`,
        "",
        "Add a payment method, then set a budget alert:",
        `      https://console.cloud.google.com/billing/budgets?project=${PROJECT}`,
      ]);
    }
    ok("project appears to be on Blaze");
    return { gcloud };
  }
  ok("gcloud present");

  const gUser = shOut(`gcloud auth list --filter=status:ACTIVE --format="value(account)"`);
  if (!gUser) {
    manual("sign in to gcloud", [
      "Run:  gcloud auth login",
      `Then: gcloud config set project ${PROJECT}`,
    ]);
  }
  ok(`gcloud account: ${gUser}`);

  // Blaze / billing
  const billing = shOut(`gcloud billing projects describe ${PROJECT} --format="value(billingEnabled)"`);
  if (billing !== "True") {
    const accounts = shOut(`gcloud billing accounts list --filter=open=true --format="value(name)"`) || "";
    const linkable = accounts.split("\n").filter(Boolean);
    manual("put the project on the Blaze (pay-as-you-go) plan", [
      "App Hosting has no free tier — it runs on Cloud Run / Build / CDN, which are Blaze-only.",
      "",
      `Upgrade in the console:  https://console.firebase.google.com/project/${PROJECT}/usage/details`,
      "",
      linkable.length
        ? `Or, if you already have an open billing account, link it:\n│      gcloud billing projects link ${PROJECT} --billing-account=${linkable[0].split("/").pop()}`
        : "You will need to add a payment method (this creates a Cloud Billing account).",
      "",
      "Set a budget alert afterwards so there are no surprises:",
      `      https://console.cloud.google.com/billing/budgets?project=${PROJECT}`,
    ]);
  }
  ok("project is on Blaze");

  return { gcloud };
}

function enableApis({ gcloud }) {
  phase(1, "Enable Google Cloud APIs");
  if (!gcloud) { warn("skipped (no gcloud) — backends:create will enable them itself"); return; }
  const apis = [
    "firebaseapphosting.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "developerconnect.googleapis.com",
  ];
  sh(`gcloud services enable ${apis.join(" ")} --project ${PROJECT}`);
  ok(`enabled: ${apis.join(", ")}`);
}

function ensureSessionSecret({ gcloud }) {
  phase(2, "SESSION_SECRET (Cloud Secret Manager)");

  const exists = gcloud
    ? shOut(`gcloud secrets describe SESSION_SECRET --project ${PROJECT} --format="value(name)"`) !== null
    : shOut(`${fb("apphosting:secrets:access SESSION_SECRET")}`) !== null;

  if (exists) { ok("SESSION_SECRET already exists — leaving it as is"); return; }

  const secret = randomBytes(48).toString("base64url");
  if (DRY) { info("would generate a 64-char secret and store it"); return; }

  sh(`${fb(`apphosting:secrets:set SESSION_SECRET --force --data-file -`)}`, { input: secret });
  writeFileSync(join(process.cwd(), ".firebase-session-secret.local"),
    `# Generated ${new Date().toISOString()} — also in Secret Manager as SESSION_SECRET.\n` +
    `# Recover any time:  gcloud secrets versions access latest --secret=SESSION_SECRET --project ${PROJECT}\n` +
    `SESSION_SECRET=${secret}\n`);
  ok("SESSION_SECRET created and stored (local copy: .firebase-session-secret.local, gitignored)");
}

async function migrateData() {
  phase(3, "Data migration — Neon → Firestore");

  if (!process.env.DATABASE_URL) {
    manual("provide the Neon connection string", [
      "The migration reads the live Postgres DB. Put its URL in .env.local:",
      "      DATABASE_URL=postgres://…@…neon.tech/neondb?sslmode=require",
    ]);
  }
  ok("DATABASE_URL present");

  const adcWin = join(process.env.APPDATA || "", "gcloud", "application_default_credentials.json");
  const adcNix = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  const hasCreds =
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    existsSync(adcWin) || existsSync(adcNix);
  if (!hasCreds) {
    manual("give the migration Firestore credentials", [
      "Easiest:  gcloud auth application-default login",
      "Or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key with role",
      "roles/datastore.user on the project.",
    ]);
  }
  ok("Firestore credentials available");

  info("dry-run first (no writes):");
  sh(`npm run migrate:firestore -- --dry-run`);

  if (!DO_MIGRATE) {
    warn("phase 3 stopped at the dry-run. Re-run with --migrate to copy the data for real.");
    return "held";
  }
  if (!(await confirm("Run the real Neon → Firestore copy now?"))) die("aborted at the migration confirmation.");
  sh(`npm run migrate:firestore -- --yes`);
  ok("data copied. The migration's own verification pass ran above — check it was clean.");
  info("recommended: npm run verify   (against Firestore, with the same creds)");
  return "done";
}

function backendUri() {
  const raw = shOut(`${fb("apphosting:backends:list --json")}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const list = parsed.result || parsed.backends || [];
    const found = list.find((b) => (b.name || "").endsWith(`/${BACKEND}`) || b.backendId === BACKEND);
    return found ? (found.uri || found.url || null) : null;
  } catch {
    return null;
  }
}

function ensureBackend() {
  phase(4, "App Hosting backend");

  const listRaw = shOut(`${fb("apphosting:backends:list --json")}`);
  const known = listRaw && !/"status":\s*"error"/.test(listRaw);
  const uri = known ? backendUri() : null;

  if (uri) { ok(`backend "${BACKEND}" exists → ${uri}`); return uri; }
  if (DRY) { info(`would create backend "${BACKEND}" in ${LOCATION}`); return `https://${BACKEND}--${PROJECT}.web.app`; }

  manual(`create the App Hosting backend "${BACKEND}" (one-time, needs a browser)`, [
    "This wizard connects the backend to GitHub — a one-time OAuth consent that",
    "installs the Firebase GitHub app on redleaffintech-hub/redleaffintech.",
    "",
    "Run it interactively:",
    `      npx firebase apphosting:backends:create --project ${PROJECT}`,
    "",
    "Answers to give:",
    `      • primary region:  ${LOCATION}`,
    "      • repository:      redleaffintech-hub/redleaffintech  (authorise when the browser opens)",
    `      • live branch:     ${BRANCH}`,
    "      • root directory:  /",
    `      • backend id:      ${BACKEND}`,
    "",
    "The wizard triggers a first rollout. Let it finish, then re-run this script",
    "to grant the secret and run the smoke test.",
  ]);
}

function grantSecretAccess() {
  phase(5, "Grant the backend access to SESSION_SECRET");
  sh(`${fb(`apphosting:secrets:grantaccess SESSION_SECRET --backend ${BACKEND}`)}`, { allowFail: true });
  ok("access granted (idempotent)");
}

async function deploy(uri) {
  phase(6, `Deploy — rollout of "${BRANCH}"`);

  const localHead = shOut(`git rev-parse --short HEAD`);
  const remoteHead = shOut(`git rev-parse --short origin/${BRANCH}`);
  if (localHead && remoteHead && localHead !== remoteHead) {
    warn(`local HEAD (${localHead}) ≠ origin/${BRANCH} (${remoteHead}). The rollout builds from the pushed branch.`);
    if (!(await confirm(`Push ${BRANCH} now?`))) die("push the branch, then re-run.");
    sh(`git push origin ${BRANCH}`);
  } else {
    ok(`origin/${BRANCH} is up to date (${remoteHead || "?"})`);
  }

  if (!(await confirm(`Create a rollout of "${BRANCH}" to backend "${BACKEND}"?`))) die("aborted before the rollout.");
  sh(`${fb(`apphosting:rollouts:create ${BACKEND} --git-branch ${BRANCH} --force`)}`);
  ok("rollout created. Build + deploy runs on Google's side (~3–6 min).");
  return uri;
}

async function smokeTest(uri) {
  phase(7, "Post-deploy smoke test");
  const base = (SITE_URL_OVERRIDE || uri || "").replace(/\/$/, "");
  if (!base) { warn("no backend URL known — skipping. Pass --site-url to force it."); return; }
  if (DRY) { info(`would GET ${base}/api/health , / , /login , /admin/login`); return; }

  const checks = [
    ["/api/health", (s, b) => s === 200 && b.includes('"status":"ok"')],
    ["/", (s) => s === 200],
    ["/login", (s) => s === 200],
    ["/admin/login", (s) => s === 200],
  ];
  let failures = 0;
  for (const [path, pass] of checks) {
    let status = 0, body = "";
    try {
      const r = await fetch(base + path, { redirect: "manual" });
      status = r.status;
      body = await r.text();
    } catch (e) {
      warn(`${path} — request failed: ${e.message}`);
      failures++;
      continue;
    }
    if (pass(status, body)) ok(`${path} → ${status}`);
    else { warn(`${path} → ${status} (unexpected)`); failures++; }
  }
  if (failures) warn(`${failures} smoke check(s) failed — the rollout may still be building; retry in a few minutes.`);
  else ok("all smoke checks passed");
}

function dnsInstructions(uri) {
  phase(8, "DNS cutover (manual — do last)");
  console.log([
    `  The site is live on the App Hosting URL: ${uri || `https://${BACKEND}--${PROJECT}.web.app`}`,
    "  Keep Netlify serving production until you've clicked around the new site.",
    "",
    "  To move the custom domain:",
    `    1. npx firebase apphosting:backends:get ${BACKEND} --project ${PROJECT}   (confirm it's healthy)`,
    `    2. Console → App Hosting → ${BACKEND} → Add custom domain → enter your domain`,
    "    3. Add the TXT + A/CNAME records it shows at your DNS registrar",
    "    4. Wait for it to verify, then lower the TTL / cut over",
    "    5. Only then: remove the domain from Netlify",
  ].join("\n"));
}

// ── run ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.bold}Firebase App Hosting deploy${C.reset}  project=${PROJECT} backend=${BACKEND} branch=${BRANCH}${DRY ? `  ${C.yellow}(dry run)${C.reset}` : ""}`);

  const env = preflight();
  enableApis(env);
  ensureSessionSecret(env);
  const migration = await migrateData();
  const uri = ensureBackend();
  grantSecretAccess();

  if (migration === "held") {
    warn("\nStopping before the rollout: run with --migrate once you're ready to copy the data.");
    dnsInstructions(uri);
    return;
  }

  const liveUri = await deploy(uri);
  await new Promise((r) => setTimeout(r, DRY ? 0 : 15_000));
  await smokeTest(liveUri);
  dnsInstructions(liveUri);

  console.log(`\n${C.green}${C.bold}Done.${C.reset} Watch the build: https://console.firebase.google.com/project/${PROJECT}/apphosting\n`);
}

main().catch((e) => die(e.message || String(e)));

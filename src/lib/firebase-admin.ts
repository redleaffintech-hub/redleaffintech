import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

/**
 * Firebase Admin SDK singleton (§29 — datastore is Cloud Firestore).
 *
 * Credential resolution, in order:
 *   1. On Firebase App Hosting / Cloud Run: Application Default Credentials are
 *      injected automatically — nothing to configure.
 *   2. Locally / in CI: set GOOGLE_APPLICATION_CREDENTIALS to a service-account
 *      JSON path, OR set FIREBASE_SERVICE_ACCOUNT to the JSON itself (useful on
 *      hosts that only take env vars).
 *
 * Next.js re-evaluates modules on hot reload, so guard against re-init the same
 * way src/lib/db.ts guarded the Prisma client.
 */
const globalForFirebase = globalThis as unknown as {
  firebaseApp?: App;
  firestore?: Firestore;
};

function createApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;

  const inlineKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineKey) {
    const parsed = JSON.parse(inlineKey) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp({
      projectId: parsed.project_id ?? projectId,
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Env vars flatten newlines; restore them.
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    });
  }

  // ADC path (App Hosting, Cloud Run, or GOOGLE_APPLICATION_CREDENTIALS set).
  return initializeApp(projectId ? { projectId } : undefined);
}

export const firebaseApp: App = globalForFirebase.firebaseApp ?? createApp();
if (process.env.NODE_ENV !== "production") {
  globalForFirebase.firebaseApp = firebaseApp;
}

export const firestore: Firestore =
  globalForFirebase.firestore ??
  (() => {
    const db = getFirestore(firebaseApp);
    db.settings({ ignoreUndefinedProperties: true });
    return db;
  })();
if (process.env.NODE_ENV !== "production") {
  globalForFirebase.firestore = firestore;
}

export const firebaseAuth: Auth = getAuth(firebaseApp);

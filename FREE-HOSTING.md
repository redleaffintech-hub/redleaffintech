# Free hosting for a small user base

Use one Render Free Node web service and Neon Free PostgreSQL. The app retains Next.js, Prisma, authentication and accounting transactions. A framework rewrite is not required to use these plans. Standalone packaging makes the app portable; it does not guarantee lower RAM use or unlimited free hosting.

## Deploy

1. Push this revision to your repository and create a Render Blueprint using render.yaml. Select the Free service plan.
2. Use your existing Neon database to preserve users and books. Confirm its plan and usage in Neon first. Set DATABASE_URL to its pooled URL and DATABASE_URL_UNPOOLED to its direct URL. Do not copy connection strings into source control.
3. Set SESSION_SECRET to the existing production value and NEXT_PUBLIC_SITE_URL to the chosen HTTPS origin. Set any other existing production variables, including MFA encryption or contact forwarding settings, to the same values as the old host. Leave DEMO_ACCOUNTS unset.
4. The Blueprint installs dependencies, applies pending database migrations, builds the standalone server and starts it. Review pending migrations and back up the database before deployment. Do not run the demo seed against live books.
5. Before switching DNS, test the Render URL: health, homepage, login, company selection, existing reports, and a reversible draft invoice. Check static assets and logout. Validate accounting writes with a separate test company/database.
6. Switch the domain only after those checks pass. Keep the previous deployment available for rollback; do not run incompatible schema changes during the transition.

## Local build and run

npm run build:free generates Prisma and builds the standalone artifact without running migrations. It requires the normal build environment. npm run db:migrate is a separate, explicit database mutation.

To run, set DATABASE_URL, SESSION_SECRET, PORT and HOSTNAME (0.0.0.0 on a host), then run npm run start:free. Supply the same runtime settings as production. The script copies public and static assets and removes dotenv files from the artifact; secrets must be injected by the host. NEXT_PUBLIC_SITE_URL must be set at build time as well.

The /api/health endpoint checks the web process only, not database readiness. Test login/reports separately. Do not add keep-alive pings: let the web service and database sleep to preserve their free allowances.

## Limits checked September 10, 2026

- Render Free sleeps after 15 minutes idle and takes about a minute to wake. It includes 750 instance hours per workspace/month, with separate bandwidth/build allowances. Payment methods and spend limits affect overage behavior. Render describes this tier as unsuitable for production applications.
- Neon Free lists 0.5 GB storage and 100 CU-hours per project. Watch storage and compute in the dashboard; a small user count alone does not guarantee staying within quotas.
- Use Neon rather than Render Free Postgres, which expires after 30 days. Render Free has no persistent local disk; do not store uploads or SQLite data there.
- Domain registration is separate. The supplied Render subdomain avoids that cost.

Sources: https://render.com/docs/free and https://neon.com/pricing

This prepares a free-tier deployment; it does not move DNS, deploy to an account, or change the existing database.

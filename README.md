# Slotbook

Slotbook is a Next.js appointment-booking prototype with a public guest booking flow, a host dashboard, and a PostgreSQL-backed booking model. Booking operations use PostgreSQL transactions and event-row locks; the local unit suite also covers scheduling and daylight-saving behavior.

## Stack

- Next.js App Router, React, TypeScript (strict mode), Tailwind CSS
- PostgreSQL 16+, Prisma ORM and checked-in SQL migration
- Zod request validation, Luxon IANA timezone handling
- Vitest unit and PostgreSQL integration tests
- Docker Compose for a disposable local PostgreSQL service

## Prerequisites

- Node.js 22 and npm
- Docker Desktop with its Linux engine running, or a separately installed PostgreSQL 16+ instance with a test database and credentials

## Environment

Copy `.env.example` to `.env`, then set a private `AUTH_SECRET` of at least 32 characters. For a local PostgreSQL server, configure `DATABASE_URL` with that database's credentials. Never use the sample database password or secret outside local development.

```powershell
Copy-Item .env.example .env
```

The `.env.example` values are placeholders. If Docker is unavailable, install/run PostgreSQL locally and set `DATABASE_URL` to a database you own, for example `postgresql://<user>:<password>@localhost:5432/slotbook?schema=public`. Then apply migrations and seed as shown below. The integration suite must use a disposable PostgreSQL test database; it creates and deletes test hosts.

## Local development

1. Install dependencies:
   ```powershell
   npm ci --legacy-peer-deps
   ```
2. Start PostgreSQL:
   ```powershell
   docker compose up -d db
   ```
3. Apply the checked-in migration and seed the demo host:
   ```powershell
   npm run db:migrate
   npm run seed
   ```
4. Start Next.js:
   ```powershell
   npm run dev
   ```

The demo host email defaults to `demo@slotbook.app`; set `HOST_PASSWORD` to a private password of at least 12 characters in `.env`. The same configured values are used by the repeatable seed.

## Docker

After setting `AUTH_SECRET` in `.env`, run:

```powershell
docker compose up --build
```

Compose waits for PostgreSQL health, runs `prisma migrate deploy`, seeds repeatable demo records, and starts the app. Set `POSTGRES_PASSWORD`, `HOST_PASSWORD`, and `AUTH_SECRET` in `.env`; do not commit real credentials or expose this local configuration publicly.

## Main routes

- `/demo-host/intro-call` — public event booking
- `/dashboard` — signed-cookie host dashboard
- `/login` — host login
- `/bookings/:token` — private booking management, confirmation, reschedule, and cancellation

## REST API

- `GET /api/hosts/{host}/events/{slug}/slots?from=&to=&tz=` — available UTC instants with guest-local date/time labels
- `POST /api/holds` — accepts `{ eventTypeId, start, timezone }` to create a five-minute hold; guest details may also be supplied. Supports `Idempotency-Key`; reusing a key with a different request returns `409`.
- `POST /api/holds/{id}/confirm` — confirms an unexpired hold and accepts `{ guestName, guestEmail }` when they were not supplied at hold creation
- `POST /api/bookings/{token}/reschedule` — accepts `{ newStart }`
- `POST /api/bookings/{token}/cancel` — accepts an optional `{ reason }`
- `POST /api/host/bookings/{id}/cancel` — host-only cancellation with a required reason
- `GET /api/host/event-types` — list event types for the authenticated host
- `POST /api/host/event-types` — create an event type
- `PATCH /api/host/event-types/{id}` — update an event type
- `DELETE /api/host/event-types/{id}` — delete only if the event has no booking history
- `PATCH /api/host/profile` — update the authenticated host name and IANA home time zone
- `GET`/`PUT /api/host/event-types/{id}/availability` — read/replace host-local weekly windows
- `GET`/`POST /api/host/event-types/{id}/overrides` — list/create a date override
- `PATCH`/`DELETE /api/host/event-types/{id}/overrides/{overrideId}` — edit/remove an override

The notification table is a database sink; no real email is sent.

## Booking and time-zone behavior

- A hold expiry is set by PostgreSQL to `clock_timestamp() + INTERVAL '5 minutes'`.
- Hold creation locks the event row before checking overlaps/capacity and inserting.
- Rescheduling holds the same event lock and atomically updates the existing booking only after the target slot passes schedule and capacity checks.
- Holds with `expiresAt <= database time`, expired rows, and cancelled rows do not consume capacity.
- Booking timestamps use PostgreSQL `TIMESTAMPTZ`; recurring availability and date overrides use host-local wall time / date.
- Nonexistent DST wall-clock starts are skipped. Ambiguous repeated wall-clock starts are omitted rather than choosing an offset silently. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Validation and tests

```powershell
npm ci --legacy-peer-deps
npx playwright install chromium firefox webkit
npm run lint
npm test
npm run test:e2e
npm run build
npm run test:integration
```

`npm test` runs deterministic unit tests and reports PostgreSQL integration tests as skipped. `npm run test:integration` requires `E2E_DATABASE_URL` to point to a dedicated PostgreSQL test database different from `DATABASE_URL`; it creates the retained `slotbook_integration` schema, applies migrations there, and uses uniquely identified host fixtures. It never falls back to `DATABASE_URL`, drops/truncates data, or modifies the development database.

`npm run test:e2e` launches the actual Next.js app on `http://127.0.0.1:3100` and runs the Chromium, Firefox, and WebKit projects. Playwright downloads browser binaries separately from npm dependencies; install them with `npx playwright install chromium firefox webkit`. Failure screenshots, traces, video, and the HTML report are written to ignored `test-results/` and `playwright-report/` folders.

Playwright requires `E2E_DATABASE_URL` to point to a dedicated PostgreSQL test database different from `DATABASE_URL`; it refuses to fall back to the development URL. Prisma uses the isolated PostgreSQL schema `slotbook_e2e`. The suite never resets, truncates, or drops a database or schema. It applies the checked-in migrations to the isolated schema, creates a uniquely named host and event fixture, and removes only that fixture host (and its dependent test records) on teardown. The schema and migration ledger are retained. The test account password is generated for each run and stored only in ignored `.playwright/fixture.json`; stale recorded fixtures are identity-checked and cleaned at the next run.

For CI, configure `E2E_DATABASE_URL` as a PostgreSQL test connection and install the browser binaries before running `npm run test:e2e`. PostgreSQL fixtures are real and isolated; the browser tests do not mock API responses or substitute SQLite.

## Dependency security

The latest `npm audit --omit=dev` reports no production advisories. The full audit reports eight moderate advisories in the development lint toolchain: `eslint-config-next` 16.4.5 includes `typescript-eslint`, whose parser depends on vulnerable `minimatch` versions. npm only offers a forced downgrade of `eslint-config-next` to 15.5.29 as a fix; this would move the project off Next.js 16 and was not applied. The remaining advisory is limited to development tooling.

Vitest and its coverage provider were upgraded from 2.x to 5.1.0 to address the test-runner advisories; Vite 7.3.7 is installed as Vitest 5's required peer. Unit, PostgreSQL integration, cross-browser E2E, lint, and production build checks pass with this toolchain.

## 60-second UI tour

Open `/login` and sign in with the demo account. The dashboard lists seeded event types and upcoming bookings. Open `/demo-host/intro-call` to browse slots, change the guest timezone, and confirm a booking. The confirmation link opens its private management page, where a guest can reschedule or cancel. Host cancellation is available from the dashboard.

## Known gaps

- Host event type, profile, weekly availability, and date override management are available in the dashboard. Chromium E2E tests cover host authentication/management and the guest hold, confirmation, private-link, reschedule, cancellation, and capacity-release journey against PostgreSQL.
- PostgreSQL 18 is configured locally on port 5433. Docker Desktop's Linux engine is unavailable in this environment, so local PostgreSQL is used for database-backed verification.
- The full npm audit still reports eight moderate development-tooling advisories described above; email delivery is intentionally not implemented.

See [docs/REQUIREMENTS_AUDIT.md](./docs/REQUIREMENTS_AUDIT.md) for the itemized acceptance status.

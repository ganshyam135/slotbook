# Slotbook

Slotbook is a PostgreSQL-backed appointment scheduling application. Hosts manage event types and local availability; guests find a time, reserve a short hold, confirm, and manage the resulting booking.

## Features

- Host login and dashboard for event types, weekly availability, date overrides, profile/time zone, and upcoming bookings.
- Public date/time selection with guest time-zone display and availability indicators.
- Five-minute holds, booking confirmation, private guest management links, rescheduling, and cancellation.
- Capacity limits, buffers, minimum notice, booking horizon, idempotency, and host-wide overlap protection.
- PostgreSQL notification-event records; no email is sent.

## Architecture and technology

- Next.js App Router, React, TypeScript (strict mode), and Tailwind CSS.
- PostgreSQL as the source of truth; Prisma schema and checked-in SQL migrations.
- Zod request validation and Luxon IANA time-zone/DST handling.
- Business logic in `src/lib`; route handlers under `src/app/api`; reusable UI in `src/components`.
- Vitest unit and PostgreSQL integration tests; Playwright E2E tests in Chromium, Firefox, and WebKit.

Booking writes use PostgreSQL transactions. Operations that change active booking intervals acquire the host row lock before event and booking locks, then recheck availability and capacity. This makes the host calendar the shared resource across event types. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22 and npm.
- PostgreSQL 16+ for development, or Docker Desktop with Docker Compose for the isolated test database.
- Playwright browser binaries for E2E tests: `npx playwright install chromium firefox webkit`.

## Environment configuration

Copy `.env.example` to `.env` and set private values. `DATABASE_URL` is the application/development database. Set `AUTH_SECRET` to a private value of at least 32 characters and set `HOST_PASSWORD` to the password for the seeded demo host (at least 12 characters). The seed uses `HOST_EMAIL` if supplied; otherwise it uses `demo@slotbook.app`.

```powershell
Copy-Item .env.example .env
```

`.env` is local and ignored by Git. Never commit real environment values. The test setup creates a separate ignored `.env.test.local`; it does not overwrite `.env` or `DATABASE_URL`.

## Isolated Docker PostgreSQL for tests

The Compose setup starts PostgreSQL only; it does not containerize or start the Next.js application. It creates database `slotbook_test` with a dedicated local test user, maps `127.0.0.1:5434` to container port 5432, and persists data in the uniquely named `slotbook_test_postgres_data` volume. It does not use the development PostgreSQL server on port 5433.

Generate the ignored test environment file once. The command creates a random local test password and refuses to overwrite an existing file:

```powershell
npm run db:test:env
docker compose --env-file .env.test.local up -d db
```

Wait for the health check:

```powershell
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $health = docker inspect --format='{{.State.Health.Status}}' slotbook-test-postgres
  if ($health -eq "healthy") { break }
  Start-Sleep -Seconds 2
}
if ($health -ne "healthy") { throw "Slotbook test PostgreSQL did not become healthy." }
```

The integration and Playwright runners load `.env.test.local`, validate that its database differs from `DATABASE_URL`, and migrate their own retained schemas: `slotbook_integration` and `slotbook_e2e`. Do not seed the test database; the suites create their own fixtures.

Stop the service without deleting its data:

```powershell
docker compose --env-file .env.test.local stop db
```

Do not use `down -v` if you want to preserve the named volume.

## Migrations, seed, and development

Install dependencies and generate Prisma Client:

```powershell
npm ci --legacy-peer-deps
npx prisma generate
```

After confirming that `DATABASE_URL` names the intended development database, apply migrations and optionally seed the demo host and event types:

```powershell
npm run db:migrate
npm run seed
```

These commands use `DATABASE_URL`; they are not part of Docker test startup. The seed requires `HOST_PASSWORD` and upserts `demo-host` with `intro-call` and `office-hours`.

Start the application:

```powershell
npm run dev
```

## Demo host and pages

- Demo email: `demo@slotbook.app` (unless overridden by `HOST_EMAIL`).
- Password: the local `HOST_PASSWORD` value configured before running the seed. No default demo password is published or committed.
- Public event: `/demo-host/intro-call`.
- Host sign-in: `/login`; dashboard: `/dashboard`.
- Private guest management links are created after booking confirmation and should be treated as secrets.

## API overview

Public booking:

- `GET /api/hosts/{host}/events/{slug}/slots?from={ISO}&to={ISO}&tz={IANA}` — returns available slots and a privacy-safe availability summary; it does not return guest names, emails, or booking identifiers.
- `POST /api/holds` — creates a hold from `{ eventTypeId, start, timezone }`; optional guest details may be supplied. Supports `Idempotency-Key`; key reuse with a different request returns `409`.
- `POST /api/holds/{id}/confirm` — confirms an unexpired hold; accepts `{ guestName, guestEmail }` if not already supplied.
- `POST /api/bookings/{token}/reschedule` — guest management token authorizes `{ newStart }`; availability is revalidated by the server.
- `POST /api/bookings/{token}/cancel` — guest management token authorizes cancellation with optional `{ reason }`.

Host operations:

- `POST /api/auth/login` and `POST /api/auth/logout` — host session login/logout.
- `GET /api/host/event-types`; `POST /api/host/event-types`; `PATCH` and `DELETE /api/host/event-types/{id}` — authenticated event type management.
- `PATCH /api/host/profile` — update host name and IANA time zone.
- `GET`/`PUT /api/host/event-types/{id}/availability` — read/replace weekly availability.
- `GET`/`POST /api/host/event-types/{id}/overrides` and `PATCH`/`DELETE /api/host/event-types/{id}/overrides/{overrideId}` — manage date overrides.
- `POST /api/host/bookings/{id}/cancel` — authenticated host cancellation with a required reason.

The database notification sink records lifecycle events; it does not deliver email.

## Tests and verification

```powershell
npm run lint
npm test
npm run test:integration
npm run test:e2e
npx tsc --noEmit
npm run build
```

`npm test` runs the unit suite; PostgreSQL-only cases are skipped there by design. `npm run test:integration` requires the isolated test database and applies migrations to `slotbook_integration`. `npm run test:e2e` starts the actual Next.js app, applies migrations to `slotbook_e2e`, and runs against real PostgreSQL in all three browser projects. Both database-backed runners refuse to fall back to `DATABASE_URL`; neither resets nor truncates the database. E2E setup and teardown own and clean only their fixtures; schemas and migration history remain. Playwright reports, screenshots, traces, videos, local fixture data, and environment files are ignored by Git.

Latest recorded verification: 32 unit tests passed (27 PostgreSQL tests skipped by the unit runner); all 27 PostgreSQL integration tests passed; all 15 Playwright tests passed (five per browser); lint, TypeScript checking, and the production build passed. See [docs/SUBMISSION_REPORT.md](./docs/SUBMISSION_REPORT.md) and [docs/REQUIREMENTS_AUDIT.md](./docs/REQUIREMENTS_AUDIT.md) for scope, exact results, and remaining gaps.

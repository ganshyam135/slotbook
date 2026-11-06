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
- Docker Desktop with Docker Compose for the isolated local app/test PostgreSQL database.
- Playwright browser binaries for E2E tests: `npx playwright install chromium firefox webkit`.

## 60-second tour

1. Start the app using the setup steps below, then open `http://localhost:3000/demo-host/intro-call` to see the guest booking page.
2. Select a date and available time, enter guest details, confirm, then follow the private management link to reschedule or cancel.
3. Open `http://localhost:3000/login` and sign in with `demo@slotbook.app` and the local `HOST_PASSWORD` value to see the host dashboard, event types, availability, overrides, and bookings.

The demo password is deliberately not published. The repository history does not identify whether an external starter template was used; confirm its name or state that no template was used before publishing.

## Environment configuration

Copy `.env.example` to `.env` and set private values. Set `AUTH_SECRET` to a private value of at least 32 characters and `HOST_PASSWORD` to the password for the seeded demo host (at least 12 characters). The seed uses `HOST_EMAIL` if supplied; otherwise it uses `demo@slotbook.app`. `DATABASE_URL` remains the development database setting; the one-command local bootstrap deliberately does not use or overwrite it.

```powershell
Copy-Item .env.example .env
```

`.env` is local and ignored by Git. Never commit real environment values. The test setup creates a separate ignored `.env.test.local`; it does not overwrite `.env` or `DATABASE_URL`.

## One-command local startup and isolated Docker PostgreSQL

The Compose setup starts PostgreSQL only; Next.js runs locally. It creates database `slotbook_test` with a dedicated local user, maps `127.0.0.1:5434` to container port 5432, and persists data in the uniquely named `slotbook_test_postgres_data` volume. It does not use the development PostgreSQL server on port 5433.

After configuring `.env`, generate the ignored test environment file once. This creates a random local test password and refuses to overwrite an existing file:

```powershell
npm run db:test:env
```

Start the database, wait for health, apply migrations, seed the demo host, and run the app with:

```powershell
npm run dev:bootstrap
```

This command uses the isolated `slotbook_test` database's `public` schema for the local demo. It derives its connection from `E2E_DATABASE_URL` in `.env.test.local`, checks that the target is exactly the local test database and differs from `DATABASE_URL`, and leaves both environment files unchanged. The integration and Playwright runners use separate schemas (`slotbook_integration` and `slotbook_e2e`) and create their own fixtures.

Stop the service without deleting its data:

```powershell
docker compose --env-file .env.test.local stop db
```

Do not use `down -v` if you want to preserve the named volume.

## Dependencies and routine development

Install dependencies and generate Prisma Client:

```powershell
npm ci --legacy-peer-deps
npx prisma generate
```

The one-command bootstrap runs migrations and the idempotent demo seed before starting Next.js. The seed upserts `demo-host` with `intro-call` and `office-hours`. Once the database is running and migrated, `npm run dev` can start Next.js directly; it uses `DATABASE_URL` from `.env`, so use it only when that URL targets the intended database.

For subsequent development sessions:

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
npm run test:all
```

`npm run test:all` runs unit, isolated PostgreSQL integration (including concurrency), and Playwright E2E suites sequentially. Start the isolated Docker test database, create `.env.test.local`, and install Playwright browsers first. The runner keeps integration and E2E data in separate schemas.

Individual commands:

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

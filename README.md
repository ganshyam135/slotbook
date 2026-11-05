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
- `POST /api/holds` — accepts `{ eventTypeId, start, timezone, guestName, guestEmail }`; supports `Idempotency-Key`. Reusing a key with a different request returns `409`.
- `POST /api/holds/{id}/confirm` — confirms an unexpired hold
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
npm run lint
npm test
npm run build
npm run test:integration
```

`npm test` runs deterministic unit tests and reports PostgreSQL integration tests as skipped. `npm run test:integration` enables tests that create fixtures and issue simultaneous transactions against the configured PostgreSQL database. The suite cannot pass without valid PostgreSQL credentials.

## 60-second UI tour

Open `/login` and sign in with the demo account. The dashboard lists seeded event types and upcoming bookings. Open `/demo-host/intro-call` to browse slots, change the guest timezone, and confirm a booking. The confirmation link opens its private management page, where a guest can reschedule or cancel. Host cancellation is available from the dashboard.

## Known gaps

- Host event type, profile, weekly availability, and date override management are available in the dashboard. Browser-level end-to-end testing is still pending.
- PostgreSQL 18 is configured locally on port 5433. Docker Desktop's Linux engine is unavailable in this environment, so local PostgreSQL is used for database-backed verification.
- There are no Playwright end-to-end tests, and email delivery is intentionally not implemented.

See [docs/REQUIREMENTS_AUDIT.md](./docs/REQUIREMENTS_AUDIT.md) for the itemized acceptance status.

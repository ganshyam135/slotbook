# Slotbook submission report

## 1. Links

This deliverable is the local workspace project. No remote repository, pull request, or deployment URL has been created.

## 2. Architecture

The app uses Next.js App Router pages and route handlers, shared TypeScript business logic, Prisma, and PostgreSQL. Guest pages browse event slots and use private management links; hosts sign in to a dashboard. Booking operations are isolated in `src/lib/booking-service.ts`.

## 3. Data model

The normalized schema includes hosts, event types, weekly availability rules, date overrides, bookings, idempotency records, and notification events. SQL migrations add relational, unique, index, range, and held-expiry constraints. Booking instants are PostgreSQL `TIMESTAMPTZ`; local override days are `DATE`.

## 4. Key technical decisions

1. Use a unified booking record with explicit `held`, `confirmed`, `cancelled`, and `expired` states.
2. Set hold expiry from PostgreSQL `clock_timestamp()` rather than trusting client time.
3. Serialize reservations for one event by locking the PostgreSQL `EventType` row.
4. Persist idempotency key and result in the same transaction as the booking.
5. Derive a private token with server-keyed HMAC from a random booking UUID and persist only the token hash.
6. Store event instants in UTC and retain host availability as local wall-clock rules.
7. Omit nonexistent and ambiguous DST slot starts rather than silently normalizing or choosing an offset.
8. Write notification sink records in the same transaction as their booking state transition.

## 5. Reliability and failure handling

Hold creation rechecks configured availability and capacity while holding the event-row lock. A failed reschedule leaves the original booking unchanged because the capacity check and update are one transaction. Duplicate confirmation fails after the first successful transition. Idempotency-key reuse with a different payload returns `409`.

These transaction behaviors are implemented in code and have real-PostgreSQL integration tests, but those tests have not run successfully in this environment.

## 6. Time-zone handling and DST example

Host weekly rules use IANA time zones; persisted start/end values are UTC instants; guest responses include their local day/time. For `America/New_York` on 2026-03-08, the local clock jumps from 01:59 EST to 03:00 EDT. A 02:15 appointment start is nonexistent and omitted; 03:00 EDT corresponds to `2026-03-08T07:00:00Z`.

## 7. Optional extensions

No optional extensions such as rate limiting, observability, load testing, or deployment were undertaken. Real email delivery is intentionally absent; notifications are database sink records.

## 8. Testing and actual results

- `npm test`: passed 9 unit tests; 7 PostgreSQL integration tests were skipped in the normal run.
- `npm run lint`: passed after fixing a React effect-state lint issue.
- `npm run build`: passed after the booking changes.
- `npx prisma validate`: passed for the Prisma schema.
- `npm run test:integration`: attempted but failed during setup because PostgreSQL authentication rejected the configured `slotbook` user. None of its concurrency tests ran.
- `npx prisma migrate deploy`: attempted but failed with Prisma `P1000` for the same authentication reason.

No database-dependent test is reported as passed.

## 9. AI usage

AI assistance was used for repository inspection, requirements comparison, code changes, test authoring, validation, and documentation. Generated code was iteratively corrected in response to TypeScript, unit-test, lint, and environment failures. Details are recorded in [AI_LOG.md](../AI_LOG.md).

## 10. Known gaps and next steps

- No host UI/API currently creates or edits event types, recurring availability, date overrides, or host timezone/profile settings.
- The database migration, demo seeding, record retrieval, and transaction tests still need to run against a PostgreSQL test database with valid credentials.
- Docker startup was not tested because the Docker Desktop Linux engine was unavailable.
- Playwright end-to-end coverage and email delivery are not implemented.

The next milestone should be to configure an accessible disposable PostgreSQL database, apply the migration, run seeding and integration tests, then implement host event and availability management.

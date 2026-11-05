# Slotbook architecture

## Components

- `src/app`: App Router pages and JSON route handlers.
- `src/components`: booking, management, host-cancellation, and login UI.
- `src/lib/booking.ts`: timezone-aware slot generation and active-capacity conflict rules.
- `src/lib/booking-service.ts`: transaction boundaries and booking state transitions.
- `src/lib/auth.ts`: password helpers, signed host sessions, and deterministic private management tokens.
- `src/lib/db.ts`: the shared Prisma client.
- `prisma/schema.prisma` and `prisma/migrations`: normalized PostgreSQL schema and initial migration.

## Booking request flow

1. The guest requests a bounded date range from `GET /api/hosts/{host}/events/{slug}/slots`. The server validates the guest IANA timezone, loads host-local weekly hours and date overrides, reads active holds using database time, and returns UTC instants with guest-local labels.
2. The guest posts a selected UTC instant and guest details to `POST /api/holds`.
3. If an idempotency key is present, the transaction inserts or locks its unique database record first. A matching completed request replays the original booking reference; different request content returns `409`.
4. The transaction locks the `EventType` row using `SELECT ... FOR UPDATE`, validates the requested slot against the current schedule, checks overlapping active bookings including configured buffers, then inserts the hold.
5. PostgreSQL sets expiry with `clock_timestamp() + INTERVAL '5 minutes'`. The transaction also writes the hold notification. The private token is derived from the booking UUID using the server secret; only its SHA-256 hash is stored in `Booking`.
6. Confirmation locks the booking row and checks expiry against `clock_timestamp()`. A successful transition and notification are atomic. An expired hold is marked `expired` and confirmation returns `409`.
7. Rescheduling locks the event row and then the booking row, checks the new configured slot and active capacity excluding the current booking, and updates the existing row plus its notification in one transaction. If a check fails, the transaction leaves the original booking untouched.
8. Cancellation locks the booking row and atomically marks it cancelled with a reason and notification.

## Database design and constraints

The schema separates `Host`, `EventType`, `AvailabilityRule`, `AvailabilityOverride`, `Booking`, `IdempotencyKey`, and `Notification`. Foreign keys cascade from host/event records. Unique constraints cover host email/slug, event slug per host, one date override per event, management-token hashes, and idempotency keys.

The initial SQL migration additionally enforces event duration, capacity, buffer, weekday, minute-window, booking interval, and held-booking-expiry constraints. PostgreSQL timestamps are `TIMESTAMPTZ`; local override dates use `DATE`.

## Locking and capacity correctness

Every hold creation and reschedule locks the same event row before counting seats. PostgreSQL serializes these operations for a particular event while allowing unrelated event types to proceed concurrently. The active-seat query includes confirmed bookings and holds whose expiry is later than a database-clock reading. It excludes expired and cancelled records. For an event's capacity, each overlapping booking consumes one seat.

Rescheduling evaluates capacity while the existing booking is still present, excluding only that booking from the target-slot count, then updates its interval in the same transaction. No JavaScript mutex or in-memory lock participates in correctness.

The PostgreSQL integration suite in `tests/integration/booking-concurrency.spec.ts` covers simultaneous capacity-one and group holds, concurrent rescheduling, idempotent retries, expiry, confirmation, and cancellation. It must be run against a disposable PostgreSQL database; the checked-in suite has not been successfully run in the current environment because the available service rejects the configured credentials.

## Time-zone and DST policy

The host timezone is an IANA identifier. Weekly rules are stored as wall-clock minutes within a local weekday, and override dates are stored as PostgreSQL `DATE`. Slot starts are resolved in the host zone; slot start/end instants are returned and persisted in UTC.

For daylight-saving transitions, a nonexistent local start is omitted. A repeated/ambiguous local start is also omitted rather than silently selecting one of its two possible offsets. A nonexistent availability-window end is shifted forward according to Luxon's gap normalization; an ambiguous window end uses the later occurrence so the declared window includes the repeated interval. Slot duration itself is elapsed time, not assumed local-clock arithmetic.

Example: in `America/New_York`, on 2026-03-08 the clock jumps from 01:59 EST to 03:00 EDT. A 02:15 local start does not exist and is not offered. A 03:00 start is persisted as `2026-03-08T07:00:00Z`.

## Authentication and private links

Passwords use bcrypt. The host cookie contains a host ID and expiry signed with `AUTH_SECRET` and is marked HTTP-only, SameSite=Lax, and Secure in production. Management links use a keyed HMAC token derived from the unpredictable booking UUID; the database stores only a SHA-256 hash and indexes it uniquely. Rotating `AUTH_SECRET` invalidates existing sessions and management links, so production secret rotation requires a planned migration strategy.

## Reliability and limitations

- API payloads are validated with Zod; conflicting slots and idempotency-key reuse produce explicit `409` responses.
- Booking transitions and notification records share the same transaction.
- Notifications are persisted in PostgreSQL only. No email delivery is claimed.
- Unit tests cover isolated scheduling, buffers, capacity semantics, DST, and signed-token behavior.
- Database migration, seed, runtime operations, and concurrency guarantees still require verification against an accessible PostgreSQL database.
- Host-side event/availability CRUD and profile settings are not implemented yet.

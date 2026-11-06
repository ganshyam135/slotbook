# Slotbook submission report

## Project summary

Slotbook is a host-and-guest appointment scheduling application. Hosts configure event types, weekly availability, date overrides, profile details, and review upcoming bookings. Guests browse public availability, create and confirm a temporary hold, and manage confirmed appointments through a private link.

No deployment URL, remote repository link, or screenshot is claimed here.

## Architecture and data model

The application uses Next.js App Router pages and route handlers, React, strict TypeScript, Tailwind CSS, Prisma, and PostgreSQL. API routes validate input and call business logic in `src/lib`; PostgreSQL is the source of truth.

The Prisma model contains:

- `Host` and `EventType` for host identity, event configuration, duration, capacity, buffers, notice, and booking horizon.
- `AvailabilityRule` for recurring host-local weekday windows and `AvailabilityOverride` for date-specific closures or hours.
- `Booking` for UTC start/end instants, guest details, lifecycle status, hold expiry, cancellation reason, and a stored management-token hash.
- `IdempotencyKey` for durable request identity/results and `Notification` for transactional lifecycle event records.

The checked-in PostgreSQL migration adds relational constraints, indexes, uniqueness constraints, and check constraints. The Compose setup supplies an isolated PostgreSQL test database; it does not containerize the app.

## Booking lifecycle and concurrency

The lifecycle is `held → confirmed → cancelled`; a held booking can instead become `expired`. PostgreSQL sets a hold's expiration to `clock_timestamp() + INTERVAL '5 minutes'`. Capacity reads compare expiry with database time, so elapsed holds do not consume a seat even before a status cleanup occurs.

Mutations that can change active booking intervals use PostgreSQL transactions and row locks. They acquire locks in the order **host → event type → booking** (hold creation first serializes its idempotency record, then follows this order). The host row is the shared calendar lock across different event types; event locks preserve per-event capacity. After taking locks, the service rechecks schedule, capacity, buffers, and host-wide conflicts before writing. There are no JavaScript in-memory locks.

Confirmed bookings and unexpired holds reserve host calendar time. Cancelled and expired bookings do not. Overlap checks include duration and configured buffers. Confirmation revalidates the calendar. Rescheduling checks and updates the target inside one transaction, so a failed move leaves the prior booking unchanged and a successful move releases the old interval atomically. Idempotency results are stored with the booking transaction; replaying the same key and payload returns the original result, while reusing a key with different content returns `409`.

## Time zones and DST

Weekly availability is expressed as wall-clock time in the host's IANA time zone; override dates are local calendar dates. Appointment starts and ends are stored as PostgreSQL `TIMESTAMPTZ` instants. Guests can select a display time zone; public availability returns localized labels without guest or booking identifiers.

Nonexistent DST local start times and ambiguous repeated local start times are omitted rather than silently shifted or assigned an arbitrary offset. A nonexistent availability-window end is normalized forward by Luxon; an ambiguous window end uses the later occurrence. Appointment duration is elapsed time.

## Authentication and booking management

Host passwords are bcrypt-hashed. Host sessions are signed, expire after eight hours, and use an HTTP-only, SameSite=Lax cookie that is Secure in production. Guest management links are private token-bearing URLs; the database stores a hash, and the token is validated server-side for management operations and self-excluding reschedule availability. Cancelling requires a reason field; host cancellation also requires a reason.

## Notifications

Booking state transitions write notification sink records in their database transaction. These records are not sent as email; an outbound email delivery service is not implemented.

## Testing strategy and actual results

Verification was run against the local project and the isolated Docker PostgreSQL test database (`slotbook_test`), using separate retained `slotbook_integration` and `slotbook_e2e` schemas. The runners reject the development database and do not reset or truncate it.

Latest recorded results:

| Check | Result |
|---|---|
| `npm run test` (twice) | Passed both runs: 32 unit tests passed; 27 PostgreSQL-only tests skipped by the unit runner. |
| `npm test` | Passed: 32 unit tests passed; 27 PostgreSQL-only tests skipped. |
| `npm run test:integration` | Passed: 27 real-PostgreSQL integration tests. |
| `npm run test:e2e` | Passed: 15 Playwright tests, five each in Chromium, Firefox, and WebKit. |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed; optimized production build and integrated type checking completed. |
| `git diff --check` | Passed during this submission documentation update. |

Integration coverage includes event capacity and host-wide overlap races, limited group capacity, concurrent rescheduling, idempotency retries, active/expired holds, confirmation, and cancellation. E2E coverage exercises guest booking/management and host management across the three browser projects.

The prior PostgreSQL setup also applied the checked-in migration and ran the seed without resetting the development database. The seed requires a locally configured `HOST_PASSWORD`; it does not define or publish a default password.

## AI usage

AI assistance was used throughout the project for codebase inspection, assignment comparison, implementation, test authoring, debugging, and documentation. Changes were checked against existing implementation and tests; failed browser runs were diagnosed from their Playwright traces before fixes were made. Current browser results are reported as passed only after the successful three-browser run. The AI usage history and verification notes are recorded in [AI_LOG.md](../AI_LOG.md).

## Remaining limitations and submission gaps

- The original assignment PDF was not present in the workspace. The requirements comparison uses the supplied assignment-text snapshot referenced by the existing audit; PDF-specific wording could not be independently checked.
- The recorded assignment requirements identify pnpm as the requested package manager, while this project uses npm and `package-lock.json`.
- The recorded requirements call for sidebar navigation; the dashboard uses a top-level header/navigation instead.
- The recorded requirements mention shadcn/ui and Lucide where useful. The application uses Tailwind UI; Lucide is a dependency but its icons are not currently used.
- Docker Compose is intentionally database-only, per the setup scope; it does not run the Next.js app, migrations, or seed automatically. Those are separate documented commands.
- `docs/SUBMISSION_REPORT.md` is Markdown. If the evaluator requires a PDF report, a PDF export remains necessary.
- No production deployment or real outbound email delivery is included. Notification events are database records only.

See [docs/REQUIREMENTS_AUDIT.md](./REQUIREMENTS_AUDIT.md) for the itemized requirement status and evidence.

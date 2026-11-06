# Slotbook requirements audit

## Audit basis

The original assignment PDF was not present in the workspace or current session attachments. This comparison uses the supplied assignment-text snapshot referenced by the previous audit. PDF-only wording, page references, or later rubric changes cannot be independently confirmed. The detailed implementation evidence is in `src/`, `prisma/`, `tests/`, `README.md`, and `docs/ARCHITECTURE.md`.

Statuses are based on observed behavior and executed checks, not the presence of a file alone:

- **Implemented and verified** — directly exercised by passing tests, an applied migration/seed, or a successful production build as applicable.
- **Implemented but not fully verified** — implementation is present but some surface or edge is not directly tested.
- **Partially implemented** — only part of the stated requirement is present.
- **Missing** — not present in the current project.

## Requirement matrix

| Requirement | Status | Evidence and remaining gap |
|---|---|---|
| Next.js App Router, React, TypeScript, Tailwind UI | Implemented and verified | App and component structure in `src/app` and `src/components`; `npm run build` succeeds. |
| pnpm package manager | Missing | Project uses npm and `package-lock.json`; no pnpm lockfile or scripts. |
| shadcn/ui and Lucide where useful | Partially implemented | Tailwind components are used directly; Lucide is a dependency but its icons and shadcn/ui are not used. |
| Strict TypeScript | Implemented and verified | `tsconfig.json`; `npx tsc --noEmit` and production build pass. |
| Route handlers separated from business logic; input validation | Implemented and verified | `src/app/api` handlers call `src/lib`; Zod validation is used. Unit, integration, and E2E checks cover important but not every route/input combination. |
| PostgreSQL as source of truth with Prisma | Implemented and verified | `prisma/schema.prisma`, shared client in `src/lib/db.ts`; integration and E2E suites ran against PostgreSQL, not mocks or SQLite. |
| Migration and repeatable seed | Implemented and verified | Checked-in migration applied to the isolated test schemas; prior PostgreSQL setup applied migrations and ran `npm run seed`. Seed credentials come from local environment variables. |
| Relational, unique, index, range, and lifecycle constraints | Implemented and verified | Prisma schema and SQL migration; integration tests exercise database-backed writes and booking rules. Not every individual database constraint has a dedicated violation test. |
| Host authentication and protected dashboard | Implemented and verified | bcrypt password verification, signed expiring session cookie, protected host APIs; unit and browser tests cover session behavior, login, invalid credentials, dashboard access, and logout. Seeded account login itself is not a separate E2E fixture. |
| Event type create, edit, ownership, and safe deletion | Implemented and verified | Host event APIs and dashboard manager; PostgreSQL integration and E2E cover CRUD, ownership, and delete rejection for booking history. |
| Host profile and IANA timezone settings | Implemented and verified | Authenticated profile API and dashboard; PostgreSQL integration and E2E cover update behavior. |
| Weekly availability with multiple windows | Implemented and verified | Host-local rules and dashboard editing; unit, PostgreSQL, and E2E coverage include multiple windows. |
| Date override creation, edit, removal, and precedence | Implemented and verified | Override API and slot generator; unit, PostgreSQL, and E2E tests cover unavailable/custom-hour overrides and restoration. |
| Upcoming booking dashboard with guest details, local date/time, and status | Implemented and verified | `src/app/dashboard/page.tsx`; host E2E exercises the dashboard with fixture bookings. |
| Required dashboard sidebar navigation | Partially implemented | Dashboard has top-level navigation and cards; it does not use a sidebar. |
| Host cancellation with reason | Implemented but not fully verified | Authenticated route and dashboard action exist; service-level PostgreSQL lifecycle behavior is tested, but the host cancellation route/UI is not a dedicated E2E path. |
| Public event page and event information | Implemented and verified | `src/app/[host]/[eventSlug]/page.tsx`; browser E2E exercises the real public booking page. |
| Date/time selection, guest timezone switch, availability states | Implemented and verified | Public slots API plus `BookingFlow`/`AvailabilityPicker`; browser tests cover slot selection, timezone control rendering, availability states, and mobile layout. Public summaries contain no guest or booking identifiers. |
| Booking creation, guest details, confirmation, and private management link | Implemented and verified | Browser tests run the real hold and confirmation routes, validate guest input, inspect the management link, and verify duplicate confirmation rejection. |
| Five-minute expiry according to PostgreSQL time | Implemented and verified | `src/lib/booking-service.ts` sets expiry using database time; PostgreSQL integration verifies expiry, late confirmation rejection, and capacity release. |
| Expired holds and cancelled bookings release capacity | Implemented and verified | Availability and transactional checks ignore expired/cancelled bookings; PostgreSQL lifecycle tests verify release behavior. |
| Event capacity, buffers, notice, booking horizon | Implemented and verified | Server-side availability and capacity rules; unit, PostgreSQL concurrency, and browser tests cover key boundary and capacity behavior. |
| Cross-event host-wide overlap prevention | Implemented and verified | Host-row lock serializes calendar mutations across event types; PostgreSQL integration tests exercise overlapping/non-overlapping requests, holds, cancellation, confirmation, and rescheduling conflicts. |
| Idempotency and concurrent retry behavior | Implemented and verified | Idempotency record and result are transactional; PostgreSQL tests cover same-key retries and payload conflicts. |
| Atomic rescheduling and preservation on failure | Implemented and verified | Booking move is checked and written in one transaction; PostgreSQL tests cover competing moves and retained original booking on conflict; E2E covers successful guest rescheduling. |
| UTC instants, host-local availability, guest timezone | Implemented and verified | `TIMESTAMPTZ` storage, IANA validation/conversion, and date overrides; unit and browser tests cover timezone and display behavior. |
| Explicit DST gap/fold policy | Implemented and verified | Slot generation omits nonexistent and ambiguous starts; unit tests exercise spring-forward and fall-back cases. |
| Notification sink events | Implemented but not fully verified | Notification records are written transactionally; PostgreSQL integration tests verify confirmation records. Every notification type is not independently asserted. No outbound email is implemented. |
| API coverage and error handling | Implemented but not fully verified | Public booking, host management, auth, and management endpoints exist and important paths are exercised. Exhaustive route/error permutation coverage is not claimed. |
| Unit tests | Implemented and verified | Latest `npm run test`/`npm test`: 32 passed; 27 PostgreSQL-only tests are skipped by the unit runner by design. |
| Real-PostgreSQL integration tests | Implemented and verified | Latest `npm run test:integration`: 27 passed against isolated PostgreSQL schema `slotbook_integration`. |
| Playwright E2E and cross-browser coverage | Implemented and verified | Latest `npm run test:e2e`: 15 passed across Chromium, Firefox, and WebKit, five per browser, using the real app and isolated schema `slotbook_e2e`. |
| Lint, TypeScript, production build | Implemented and verified | Latest `npm run lint`, `npx tsc --noEmit`, and `npm run build` passed. |
| Docker Compose local test PostgreSQL | Partially implemented | `docker-compose.yml` runs only PostgreSQL 16 with a dedicated database, user, port, health check, and named volume. It intentionally does not containerize the app or automatically migrate/seed/start it; use the documented separate commands. |
| README setup, API, test, and architecture documentation | Implemented and verified | Updated `README.md`, `docs/ARCHITECTURE.md`, and this audit. |
| Required technical report | Partially implemented | `docs/SUBMISSION_REPORT.md` documents architecture, reliability, tests, AI use, and limitations in Markdown. If the evaluator requires a PDF, no PDF export is present. |
| AI usage log | Implemented and verified | `AI_LOG.md` records AI-assisted work and actual verification without claiming unrun checks. |

## Database and test isolation

- The local Compose test service uses database `slotbook_test` on host port 5434 with a dedicated named volume.
- `npm run test:integration` migrates and tests only the retained `slotbook_integration` schema.
- `npm run test:e2e` migrates and tests only the retained `slotbook_e2e` schema; E2E setup/teardown creates and removes its owned fixtures.
- Both runners require `E2E_DATABASE_URL`, check it differs from `DATABASE_URL`, and refuse fallback to the development database. The test scripts do not reset or truncate the database.
- Latest results: 27/27 PostgreSQL integration tests and 15/15 browser tests passed.

## Mandatory gaps and known limitations

Based on the available assignment-text snapshot, submission gaps are:

1. The requested package manager is pnpm; this repository uses npm.
2. The requested dashboard sidebar is not present; top navigation is used instead.
3. If the rubric requires the report as a PDF, the current report is Markdown only.
4. The Compose service is database-only; application startup, migration, and seeding remain separate operations.
5. shadcn/ui/Lucide usage is incomplete; the project uses Tailwind components and does not currently use the Lucide dependency.

No production deployment, outbound email delivery, or optional observability/rate-limiting/load-test extension is claimed. The original PDF must be checked by the submitter if its exact wording or export format is material to grading.

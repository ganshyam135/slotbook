# Slotbook assignment requirements audit

## Audit basis and status meanings

This audit compares the repository with the supplied five-page **Slotbook — Take-Home Assignment** PDF (Nov 4, 2026), not the earlier paraphrased requirement snapshot.

- **Implemented and verified** — behavior is supported by executed tests or direct database/build verification.
- **Implemented but not fully verified** — implementation exists, but not every required edge or delivery step is verified.
- **Partially implemented** — only part of the stated requirement is present.
- **Missing** — not present.

The checks below concern the current local repository. No public repository or production deployment is claimed.

## Core feature and technical requirements

| Requirement | Status | Evidence and remaining gap |
|---|---|---|
| Host dashboard, public booking page per event type, and JSON API | Implemented and verified | Pages in `src/app`, UI in `src/components`, and routes in `src/app/api`; Playwright covers host and guest flows. |
| Host IANA home time zone | Implemented and verified | `Host.timezone`, `src/lib/host-management.ts`, and `src/components/HostProfileForm.tsx`; profile integration and E2E coverage. |
| Event name, slug, 15–120 minute duration, capacity, 0–30 minute buffers, notice, and horizon | Implemented and verified | `EventType` in `prisma/schema.prisma`, input validation, host event APIs/UI, and PostgreSQL event-management tests. |
| Multiple weekly windows in host-local time and date overrides | Implemented and verified | Availability rule/override models, APIs, editors, slot generation, and unit, integration, and E2E coverage. |
| Host sees upcoming bookings and can cancel with a reason | Implemented and verified | `src/app/dashboard/page.tsx`, host cancellation route/component, and booking lifecycle integration tests. |
| Public event page shows the next 30 days in browser time zone with a time-zone switcher | Implemented and verified | Public page, slots API, `AvailabilityPicker`, and `BookingFlow`; browser tests cover availability rendering and timezone display. Event-specific horizons remain authoritative where configured. |
| Hold a selected slot for five minutes while entering guest details | Implemented and verified | Hold and confirm API routes; PostgreSQL sets expiry from database time. Integration and E2E tests cover details, expiry, and late confirmation. |
| Confirmation returns private link to view, reschedule, and cancel | Implemented and verified | Booking management page and token-protected routes; guest lifecycle E2E covers management, reschedule, and cancellation. |
| Lifecycle: held → confirmed → cancelled or held → expired; only active holds and confirmed bookings consume capacity | Implemented and verified | `src/lib/booking-service.ts`; real PostgreSQL lifecycle and capacity tests cover expiry and cancellation release. |
| Confirmation, reschedule, and cancellation notification events | Implemented but not fully verified | Transactional `Notification` records are persisted; integration tests verify notification writes, but do not independently assert every event type. No external email is required or claimed. |
| Documented minimum API | Implemented and verified | Endpoint overview and payload behavior are documented in `README.md`. |
| TypeScript end to end | Implemented and verified | Next.js/React source, Prisma application, and API are TypeScript; `npx tsc --noEmit` and production build pass. |
| PostgreSQL is the correctness source; no Redis/external lock service | Implemented and verified | Prisma PostgreSQL schema, SQL migration, and PostgreSQL transactions/row locks in `src/lib/booking-service.ts`; concurrency integration tests use real PostgreSQL. |
| Source, migrations, and seed script | Implemented and verified | `src/`, `prisma/migrations/`, and `src/lib/seed.ts` are tracked. |
| Demo host has two event types | Implemented and verified | Seed upserts `demo-host`, `intro-call`, and `office-hours`; the seed requires locally supplied `HOST_PASSWORD`. |
| One-command app run applies migrations, seeds, and starts the app | Partially implemented | `npm run dev:bootstrap` now applies pending migrations, seeds, and starts Next.js against configured `DATABASE_URL`. PostgreSQL must already be running; `docker-compose.yml` intentionally remains database-only and does not itself start the app. |
| One-command tests include real-PostgreSQL concurrency tests | Implemented and verified | `npm run test:all` runs unit, PostgreSQL integration, and E2E suites sequentially. The integration stage runs `tests/integration/booking-concurrency.spec.ts` against the isolated PostgreSQL schema. |

## Reliability evidence

| Failure case | Handling and test evidence |
|---|---|
| Two simultaneous requests exceed one-to-one/group capacity | Event-row locking and transactional capacity checks; `tests/integration/booking-concurrency.spec.ts` tests single and limited group capacity with concurrent requests. |
| Different event types overlap on one host calendar | Host-row lock serializes calendar mutations across event types; PostgreSQL tests cover simultaneous overlap, non-overlap, active/expired holds, cancellation, confirmation, and rescheduling. |
| Duplicate retry creates multiple holds | Durable idempotency key and transactional result; PostgreSQL test verifies concurrent same-key retries converge. |
| Hold expires while guest is deciding | Database clock sets the five-minute expiry; tests verify capacity release and failed late confirmation. |
| Reschedule target becomes occupied | Target is revalidated and updated in one transaction; failed move preserves the original booking; PostgreSQL tests cover conflicts and simultaneous reschedules. |
| DST gap/fold creates invalid local appointment | Nonexistent and ambiguous local starts are omitted; unit tests exercise both transitions. |
| Public availability leaks booking data | Public route returns slot/summary data, not guest or booking identifiers; integration tests cover safe self-exclusion using a matching private management token. |

## Submission requirements and artifacts

| Requirement | Status | Evidence and remaining gap |
|---|---|---|
| Public GitHub repository and report linking to it | Missing until submission | Repository is local; no public GitHub URL is claimed. Add the real URL to the final report after creating the repository. |
| 6–12 page PDF report or 8–15 slide deck | Missing | Current `docs/SUBMISSION_REPORT.md` is a Markdown source, not a PDF/deck. Export a reviewed report after inserting the real repository link. |
| Architecture diagram and booking request flow | Partially implemented | The flow is documented in `docs/ARCHITECTURE.md`; a Mermaid architecture diagram is included there, but the final PDF/deck must include the diagram. |
| Data model, key decisions with alternatives, reliability cases/tests, DST example | Implemented in report source | `docs/SUBMISSION_REPORT.md` contains the data model, decision trade-offs, failure/test mapping, and DST example; it must be included in the exported PDF/deck. |
| Optional extensions list and known gaps/next steps | Implemented in report source | The report distinguishes built, partial, and unbuilt optional extensions; no unimplemented extension is presented as complete. |
| README setup, API, and 60-second UI tour | Implemented | `README.md` documents setup, API, test commands, and a short host/guest tour. |
| Identify any starter template/boilerplate in README | Partially implemented | The repository history does not identify whether a starter was used. Confirm the origin and document the template name, or state that none was used. |
| AI usage log including prompts/themes, mistakes, and corrections | Implemented | `AI_LOG.md` records prompt themes, verification approach, and corrections to the earlier inaccurate requirements interpretation. |
| Full commit history; do not squash | Implemented and verified | The local history contains the incremental project commits; keep it intact when publishing. |
| Run tests with one command, including real-PostgreSQL concurrency | Implemented and verified | `npm run test:all`; it requires the dedicated test database and installed Playwright browsers. |

## Optional extensions

These are optional in the PDF, not core requirements:

| Extension | Current status |
|---|---|
| Waitlist, reminders, calendar invites, host webhooks, team round-robin, external busy times, daily cap/per-guest limit | Not implemented; not claimed. |
| Load test and measured throughput/p95/error rate | Not implemented; no load numbers are claimed. |
| Playwright E2E and CI workflow | Playwright guest/host E2E is implemented and tested; GitHub Actions CI is not present, so the combined extension is partial. |
| Abuse protection/rate limits | Not implemented. Add before public production exposure. |
| Live deployment | Not deployed; no live URL is claimed. |
| Embeddable widget | Not implemented. |
| Formal keyboard and screen-reader accessibility verification | Responsive and keyboard-relevant UI checks exist, but no dedicated screen-reader audit is claimed. |

## Database and test isolation

- `docker-compose.yml` provides PostgreSQL 16 on host port 5434 for test use. It does not modify the existing development database on port 5433.
- `npm run test:integration` uses `slotbook_integration`; `npm run test:e2e` uses `slotbook_e2e`.
- The runners load `.env.test.local` with test-specific precedence and reject using the development database URL.
- Tests clean only their owned records; they do not reset or truncate the database.

## Submission readiness

The core scheduling requirements are implemented and covered by unit, real-PostgreSQL integration, and Playwright tests. Before sending the submission, create the public GitHub repository, preserve commit history, export the Markdown report to the required PDF/deck format, insert the real repository URL, and decide whether the optional rate-limit/CI/deployment work is in scope. Do not claim a live deployment or optional feature that has not been built.

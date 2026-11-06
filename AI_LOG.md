# AI usage log

AI tools assisted with repository review, implementation, tests, debugging, and documentation. This log summarizes the work; it does not replace source history or executed test output.

## Prompt themes and work

Representative user requests included:

- Audit the booking implementation against the take-home assignment, then fix PostgreSQL concurrency and host-wide overlap behavior.
- Verify migrations, seeding, and booking concurrency against real PostgreSQL without touching the development database.
- Improve guest availability and rescheduling UI without rewriting the booking engine.
- Fix observed Playwright E2E failures by inspecting traces, screenshots, and error contexts rather than weakening assertions.
- Compare final submission readiness with the actual assignment PDF.

AI-assisted work included host event/availability management, booking lifecycle reliability, host-wide locking, timezone/DST handling, availability/rescheduling UX, isolated test setup, test authoring, and submission documentation.

## Where AI was corrected

- Earlier requirements documentation incorrectly described pnpm, sidebar navigation, and shadcn/Lucide usage as requirements and stated that the original PDF was unavailable. Direct inspection of the supplied PDF showed these were not core requirements; the current audit corrects this and identifies the actual report/run deliverables.
- Initial Playwright failures were not assumed to be application bugs. Traces and screenshots showed a mix of outdated accessible-name matching, fixture cleanup, redirect origin, and cancellation feedback issues. The fixes preserved meaningful assertions and did not alter PostgreSQL locking.
- A transient cross-browser failure was reported as such; only the full successful rerun was documented as passing.
- After review of the latest traces, the concurrent retry E2E clients were separated and their responses are consumed before context disposal. The HTTP status and shared-booking assertions remain unchanged; the database booking implementation was not modified.

## Review and verification

The implementation was reviewed against the supplied PDF and checked with unit, real-PostgreSQL integration, and cross-browser E2E suites. PostgreSQL integration and E2E tests use the isolated `slotbook_test` database with separate schemas. Their runners reject fallback to the development database and do not reset/truncate it.

Final verification in this task:

- `npm run test:all` — passed: 32 unit tests passed (27 PostgreSQL-only cases skipped by the unit runner), 27 real-PostgreSQL integration tests passed, and 15 Playwright tests passed across Chromium, Firefox, and WebKit.
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.

The first multi-browser run intermittently reported `ECONNRESET` on concurrent idempotency requests although server logs showed both expected responses. The E2E harness now gives the two independent clients separate API request contexts and reads response bodies before disposing the contexts. The same flow passed on all browsers, and the final combined run passed; the booking transaction and its assertions were left intact.

No deployment, real email delivery, optional extension, credential, or test result is claimed without evidence. The demo password remains a local `HOST_PASSWORD` value.

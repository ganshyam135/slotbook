# AI usage log

AI assistance was used during development and final preparation of Slotbook. Work included repository and assignment review, implementation support, test authoring, diagnosing failures, and documentation updates. The code and test outcomes were reviewed against the current repository; this log does not substitute for the actual test evidence below.

## Development work assisted by AI

- Compared the application with the assignment text available in the workspace history and documented coverage and gaps.
- Assisted with host dashboard management, event configuration, weekly availability, date overrides, booking lifecycle behavior, guest management, and availability UI.
- Reviewed PostgreSQL transaction boundaries, capacity enforcement, idempotency, host-wide booking conflicts, timezone conversion, and DST behavior.
- Helped add and maintain unit, real-PostgreSQL integration, and Playwright cross-browser coverage.
- Assisted with isolated PostgreSQL Compose/test setup and setup documentation. The database test service uses its own database and schema-specific test runners; no development database reset was used.
- Diagnosed Playwright failures from error contexts, screenshots, and traces. Fixes addressed normalized time-label selectors, E2E-owned fixture cleanup, logout-origin redirect behavior, cancellation feedback, and test runtime budgets. Booking transaction and locking code was not changed during that failure-fix work.

## Verification actually run

Latest recorded verification used the isolated PostgreSQL test database:

- `npm run test` — passed twice; each run had 32 passing unit tests and 27 PostgreSQL-only tests skipped by the unit runner.
- `npm test` — passed; 32 passing unit tests and 27 PostgreSQL-only tests skipped.
- `npm run test:integration` — passed all 27 integration tests against PostgreSQL.
- `npm run test:e2e` — passed all 15 Playwright tests across Chromium, Firefox, and WebKit.
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `git diff --check` — passed for the final documentation changes.

The test database uses separate retained `slotbook_integration` and `slotbook_e2e` schemas. The test runners reject fallback to the development `DATABASE_URL`; test setup and teardown do not reset or truncate the database.

## Corrections and limitations

- Initial browser failures were not treated as passing; traces and screenshots were inspected, fixes were applied, and the complete cross-browser suite was rerun successfully.
- PostgreSQL integration results are reported separately from the unit suite, where database-dependent tests are expected to be skipped.
- The original assignment PDF was not available in the workspace. Documentation records that comparison used the assignment-text snapshot referenced by the existing requirements audit.
- AI assistance did not create a deployment link, invent credentials, or claim email delivery. The demo password remains locally configured through `HOST_PASSWORD`.

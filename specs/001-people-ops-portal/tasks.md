---

description: "Task list for People Operations Portal"
---

# Tasks: People Operations Portal

**Input**: Design documents from `/specs/001-people-ops-portal/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks ARE included. The constitution's quality-gate section makes grounded-answer
accuracy, refusal correctness, access-control enforcement, and PII-leak rate release-blocking, and
quickstart.md defines four mandatory E2E specs. These are release gates, not optional extras.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Include exact file paths in descriptions

## Path Conventions

Single project. `src/` and `tests/` at repository root, per plan.md §Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization. No user story work starts here.

- [X] T001 Create the directory tree from plan.md §Project Structure in `src/` — `app/`, `components/`, `lib/`, `styles/`, `types/` — plus `tests/fixtures/`, `tests/unit/`, `tests/e2e/`
- [X] T002 Initialize the Next.js 16 App Router project in `package.json` with TypeScript 5.x, Node 22 LTS engine pin, and strict mode enabled in `tsconfig.json`
- [X] T003 [P] Install dependencies in `package.json`: `next`, `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `zod`, `@hookform/resolvers`, `googleapis`
- [X] T004 [P] Configure ESLint and Prettier in `.eslintrc.json` and `.prettierrc` with the type-aware ruleset
- [X] T005 [P] Configure Playwright in `playwright.config.ts` with `chromium` only and a `testDir` of `tests/e2e`; set base URL to `http://localhost:3000`
- [X] T006 [P] Configure Vitest in `vitest.config.ts` with `tests/unit` as the include path and jsdom environment
- [X] T007 Create `.env.example` with `N8N_BASE_URL`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `AUDIT_SHEET_ID`, `SESSION_SECRET`, `ADMIN_CONTRACT_VERIFIED` — no real values, and confirm no secret is prefixed `NEXT_PUBLIC_`
- [X] T008 [P] Create the design-token single source of truth in `src/styles/globals.css` using Tailwind v4 CSS-first `@theme` — map every token from ARCHITECTURE.md §1.2 (`--surface-*`, `--text-*`, `--border-*`, `--accent-*`, `--status-*`) plus the type scale from §1.3 and 4px spacing scale from §1.4

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST complete before ANY user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T009 Create the domain type definitions in `src/types/domain.ts`: `RowResult` as a **discriminated union** of `{state:"success",data}`, `{state:"not_found"}`, `{state:"error"}` with no fourth case; `Stage` ordered enum `not_started → it_setup → orientation → meet_and_greet → task_complete → status_confirmed → complete`; `PolicyResponse`; `WelcomeResponse`; `Freshness`; `Role`
- [X] T010 Create the shared Zod contract schemas in `src/lib/contracts/` — `employeeRowSchema` with per-row `safeParse`, `progressResponseSchema`, `policyResponseSchema`, `welcomeResponseSchema`, `adminRequestSchema` (marked provisional). This directory is imported by BOTH the browser and Route Handlers; a single definition must drive client validation and server-side revalidation
- [X] T011 Create the mixed-type cell preprocessor in `src/lib/contracts/preprocess.ts` — trim, map `""` to `undefined`, then coerce numeric strings via `z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])`. Per data-model.md: `temp_emp_id` is **NEVER** coerced to a number (stays a trimmed string key, blank is the hard reject), `cohort` blank becomes `null` and **never** `0`, `start_date` is ISO `YYYY-MM-DD` validated by regex plus a real-calendar check
- [X] T012 [P] Create the n8n webhook client in `src/lib/n8n/client.ts` — POST-only to `N8N_BASE_URL/webhook/{admin,onboarding-progress,welcome,policy}`, 10s timeout, retry **once** with jitter on 5xx and 429 only, and **never** on 4xx or a body-level `status:"error"` (FR-022). Credentials and base URL stay server-side only
- [X] T013 [P] Create the n8n response classifiers in `src/lib/n8n/classify.ts` — branch on the **body `status` field, never the HTTP code**, because `success`, `not_found`, and `error` for `onboarding-progress` all arrive as HTTP 200 (contracts/upstream-integrations.md §"The three-state trap")
- [X] T014 Create the Google Sheets client in `src/lib/sheets/client.ts` using `spreadsheets.get` with a service account, pinned to range `Sheet1!A1:J` with a `fields` mask — pinning the range is load-bearing because `Sheet2` is a byte-identical mirror that would otherwise double every employee. Use `valueRenderOption: FORMATTED_VALUE`, never `UNFORMATTED`
- [X] T015 Create the ETag-backed TTL cache in `src/lib/sheets/cache.ts` — 60s TTL plus `If-None-Match` conditional GET returning 304; serve the cached snapshot on 304, serve stale and flag it on fetch error
- [X] T016 Create the ingest pipeline in `src/lib/sheets/ingest.ts` — per-row `safeParse` loop pushing successes to `employees` and failures to `quarantined: [{rowNumber, raw, issues}]`. Ingest MUST NOT throw on a bad row; one garbage row must never fail the poll (FR-021). Never auto-delete or repair sheet rows
- [X] T017 [P] Create the session and role gate in `src/lib/auth/` — signed session cookie carrying a `role` claim of `hr_admin | manager | new_hire`, plus an authorization helper that checks role **and** employee scope. Authorization MUST run before any employee data is fetched upstream, not by filtering response text (FR-023)
- [X] T018 [P] Create the append-only audit writer in `src/lib/audit/writer.ts` — writes to the **separate** audit sheet with columns `timestamp_utc`, `actor_email`, `action`, `emp_id`, `fields_disclosed`, `request_id`. The row MUST be written **before** employee data is returned; if the audit write fails, fail the read. `actor_email` comes from the session, never from the client. Never write into the ingest range
- [X] T019 Create the PII-allowlist serializer in `src/lib/serializer/employee.ts` — an **allowlist** of emitted fields, never a denylist, so a future sheet column cannot leak by default (FR-024, SC-010). Exclude compensation, health, benefits elections, government identifiers
- [X] T020 Create the `<DataState>` wrapper in `src/components/data-state/DataState.tsx` implementing all five states — `idle`, `loading` (skeleton matching final layout), `empty`, `error`, `success` — with the dev-only blank-panel invariant: throw when `status === "success"` renders zero children
- [X] T021 [P] Create shared UI primitives in `src/components/ui/` — Button (3 variants, `aria-busy` while in flight), Input (visible labels, `aria-invalid` + `aria-describedby` on error), Card, StatusBadge (`text-micro` uppercase on `hsl(var(--status) / 0.14)`, always paired with an icon or text label so color is never the sole signal per FR-029), ProgressBar, Skeleton
- [X] T022 [P] Create the `useMediaQuery` hook in `src/lib/hooks/useMediaQuery.ts` — the basis for responsive table rendering in US1 and US5
- [X] T023 [P] Create the TanStack Query provider in `src/app/providers.tsx` with default `refetchOnWindowFocus` and a 30s `refetchInterval`
- [X] T024 Create the app shell in `src/app/layout.tsx` and `src/app/page.tsx` — navigation with role-based module visibility. Nav absence is presentation only; every route independently enforces authorization (FR-023)
- [X] T025 [P] Create the fixture library in `tests/fixtures/` with the **actually observed** payloads: `onboarding-progress` success / `not_found` / `error`, `policy` answered / **empty-answer** / refusal, `welcome` `already_sent`, and the malformed sheet row (`fafsa`/`fasfsa`/`fsafa@gma.com`) plus the mixed-type `temp_emp_id` and `cohort` rows

**Checkpoint**: Foundation ready — user story implementation can begin in parallel.

---

## Phase 3: User Story 1 — Monitor Onboarding Progress (Priority: P1) 🎯 MVP

**Goal**: HR sees every new hire's completion percentage, completed count, outstanding items,
stage, and status — and can advance a stage when permitted.

**Independent Test**: Load `/tracker` against mocked webhooks, confirm each row renders progress and
outstanding items independently, open one employee, and advance its stage.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T026 [P] [US1] Unit test per-row quarantine in `tests/unit/ingest.test.ts` — assert valid rows ingest, the malformed row lands in `quarantined` with `rowNumber`, and the poll still succeeds
- [X] T027 [P] [US1] Unit test mixed-type coercion in `tests/unit/preprocess.test.ts` — assert `temp_emp_id` stays a **string** and is never coerced to a number, a blank id is rejected, and a blank `cohort` becomes `null` and **not** `0`
- [X] T028 [P] [US1] Unit test the three-state classifier in `tests/unit/classify.test.ts` — assert `success`, `not_found`, and `error` map to three distinct union members despite all arriving as HTTP 200
- [X] T029 [P] [US1] E2E no-blank-panel spec in `tests/e2e/tracker.spec.ts` — for every progress fixture assert no `[data-state]` container has empty text, at 360px and 1280px
- [X] T030 [P] [US1] E2E partial-failure spec in `tests/e2e/tracker-partial-failure.spec.ts` — mock 1 of 60 ids as a failure; assert 59 rows render and 1 shows an inline error with retry, never a table-level error

### Implementation for User Story 1

- [X] T031 [US1] Implement `GET /api/tracker` in `src/app/api/tracker/route.ts` — read the cached roster, issue `onboarding-progress` per employee at concurrency 6, and build rows with **`Promise.allSettled`** so one failing employee never removes other rows. Return `{rows, rosterFreshness, quarantined:{count,rowNumbers}, generatedAt}` per contracts/bff-api.md. Write the audit event **before** returning
- [X] T032 [US1] Implement `GET /api/tracker/[id]` in `src/app/api/tracker/[id]/route.ts` returning `{employee, progress, freshness}`; return 404 for an id absent from the roster and 502 only when both upstream and cache fail. A single employee's upstream failure is a `{state:"error"}` row, **not** a 502
- [X] T033 [US1] Implement `POST /api/tracker/[id]/stage` in `src/app/api/tracker/[id]/stage/route.ts` — validate the stage against the ordered enum, reject backwards or duplicate transitions with 409 (the monotonic guard), enforce `can_update_stage`, and return the **authoritative refetched** progress payload rather than an optimistically constructed value (FR-010)
- [X] T034 [P] [US1] Build the tracker table in `src/components/tracker/EmployeeTable.tsx` using TanStack Table — sticky header, 48px rows, 4% zebra. One column definition drives both the desktop `<table>` and the mobile card list
- [X] T035 [P] [US1] Build `ProgressRing` and `ProgressBar` in `src/components/tracker/` — 6px track, paired with a numeric percentage and a completed/total count so the figure is never color-only
- [X] T036 [P] [US1] Build `StatusBadge` state mapping in `src/components/tracker/StatusBadge.tsx` — distinct visual treatment for `success`, `not_found` (amber mismatch flag, FR-011), and `error` (inline with retry)
- [X] T037 [US1] Build `/tracker` in `src/app/tracker/page.tsx` with TanStack Query — 30s `refetchInterval`, paused on `document.hidden`, with a **visible countdown** so the refresh is never silent (FR-020). Each row resolves on its own schedule
- [X] T038 [US1] Build `/tracker/[id]` in `src/app/tracker/[id]/page.tsx` with `OutstandingList` separating completed from outstanding, current stage, and a stage-update control **gated on `can_update_stage`** that shows the reason when disabled
- [X] T039 [US1] Add freshness display in `src/components/tracker/FreshnessIndicator.tsx` — "updated Ns ago" plus the polling countdown, so no figure is presented as live when it is not
- [X] T040 [US1] Surface the `total_items: 4` vs `total_essentials: 3` discrepancy in `src/components/tracker/` — display the webhook figure and flag the mismatch rather than silently choosing one (data-model.md)

**Checkpoint**: US1 is fully functional and independently testable. This is the MVP.

---

## Phase 4: User Story 2 — Ask Policy Questions and Get Sourced Answers (Priority: P2)

**Goal**: A new hire searches for a policy, receives an answer with its source attached, and is
told plainly when no policy covers the question.

**Independent Test**: Ask a covered question and receive an attributed answer; ask an uncovered
question and receive an explicit "not covered" response with a human contact path.

### Tests for User Story 2 ⚠️

- [X] T041 [P] [US2] Unit test the answer classifier in `tests/unit/policy-classify.test.ts` — assert `status:"success"` with `answer:""` classifies as `unanswered`, that a "does not provide enough information" answer also classifies as `unanswered`, and that **`answered` requires BOTH a non-empty answer AND a non-empty source**
- [X] T042 [P] [US2] E2E grounding spec in `tests/e2e/policies.spec.ts` — for the answered fixture assert `policy-source` is visible and non-empty; for the empty-answer fixture assert `UnansweredCard` renders **and** `policy-source` is **absent**; for the refusal fixture assert the phrase renders **verbatim**
- [X] T043 [P] [US2] Unit test the coercion invariant in `tests/unit/policy-route.test.ts` — assert the route NEVER emits `{status:"success", answer:""}` to the browser. This is the guard against the single most dangerous response shape in the system

### Implementation for User Story 2

- [X] T044 [US2] Implement `GET /api/policies/search` in `src/app/api/policies/search/route.ts` — POST `{question}` upstream, classify the result, and **coerce** any `{status:"success", answer:""}` to `{status:"unanswered", answer:null, source:null}` before it leaves the server (FR-002, FR-003, SC-003)
- [X] T045 [P] [US2] Build `AnswerCard` in `src/components/policies/AnswerCard.tsx` — answer text plus mandatory visible `source` attribution. If status is `answered` and `source` is blank, render `UnansweredCard` instead and mark the branch unreachable in tests
- [X] T046 [P] [US2] Build `UnansweredCard` in `src/components/policies/UnansweredCard.tsx` — `--unknown` hue, explicitly stating no policy covers the question and providing the People Operations contact path. Must be visually distinct from both a loading skeleton and a server error
- [X] T047 [US2] Build `/policies` in `src/app/policies/page.tsx` — debounced 400ms search, suggested starter questions (leave policy, benefits enrollment, remote work, equipment). **Search-only**: `category`, `topic`, `query`, `search`, and `action` all return 400 upstream, so no category filters may be presented
- [X] T048 [P] [US2] Build `SourceAttribution` in `src/components/policies/SourceAttribution.tsx` — displays `source` as **plain text provenance**, not a hyperlink. It is a filename (`hr_document.md`), not a URL, and cannot be linked until a filename→URL registry exists

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Audit and Trigger Welcome Sequences (Priority: P3)

**Goal**: HR reviews welcome status per employee and triggers the sequence for one that has not
received it.

**Independent Test**: View the welcome status list, trigger welcome for an unprocessed employee, and
confirm the outcome is reported accurately.

### Tests for User Story 3 ⚠️

- [X] T049 [P] [US3] Unit test welcome classification in `tests/unit/welcome-classify.test.ts` — assert `already_sent` maps to a **success** state, NOT an error, and that `emailSent:false` on `already_sent` means "no new send occurred" rather than "the send failed" (FR-017)
- [X] T050 [P] [US3] Unit test the 500 mapping in `tests/unit/welcome-route.test.ts` — assert an upstream 500 maps to 502 and **echoes the employee id** so the affected employee is identifiable (FR-018)

### Implementation for User Story 3

- [X] T051 [US3] Implement `GET /api/welcome` in `src/app/api/welcome/route.ts` — roster-sourced status list; the upstream is per-employee only, so statuses hydrate per row on demand
- [X] T052 [US3] Implement `POST /api/welcome/[id]` in `src/app/api/welcome/[id]/route.ts` returning `{status:"sent", emailSent:true}` or `{status:"already_sent", emailSent:false}`, both as HTTP 200. Validate the id client-side first, since upstream returns 500 for malformed ids
- [X] T053 [P] [US3] Build `WelcomeStatusTable` in `src/components/welcome/WelcomeStatusTable.tsx` — welcome status as the **default column**, the per-row send action as secondary. This is an audit tool, not a bulk-send console
- [X] T054 [P] [US3] Build `SendResultAlert` in `src/components/welcome/SendResultAlert.tsx` — green confirmation for both `sent` and `already_sent`, rendering the server message verbatim; red with the echoed id for failures
- [X] T055 [US3] Build `/welcome` in `src/app/welcome/page.tsx`

**Checkpoint**: US1–US3 all work independently.

---

## Phase 6: User Story 4 — Provision a New Hire (Priority: P4) ⚠️ BLOCKED

**Goal**: HR submits a new hire's details and one record is created, with the identifier returned.

**Independent Test**: Submit valid details against a **sandbox** workflow and confirm exactly one
record is created.

> **⚠️ BLOCKED**: The `admin` contract is **unverified** — it rejected every safely-testable payload
> with 400, and it is the only endpoint that creates records with no dry-run. T056–T059 are ready to
> build but T060–T062 and Scenario 8 CANNOT run until the required field set is confirmed. See
> plan.md §Complexity Tracking item 1.

### Tests for User Story 4 ⚠️

- [X] T056 [P] [US4] Unit test the provisional schema in `tests/unit/admin-schema.test.ts` — assert `temp_emp_id` and `totalEssentials` are rejected if client-supplied (FR-016), since the workflow generates both
- [X] T057 [P] [US4] E2E feature-flag spec in `tests/e2e/admin-flag.spec.ts` — with `ADMIN_CONTRACT_VERIFIED=false`, assert `/new-hire` is absent and `POST /api/admin/new-hire` returns **503** `{code:"CONTRACT_UNVERIFIED"}`
- [X] T058 [P] [US4] E2E field-validation spec in `tests/e2e/admin-validation.spec.ts` — assert a missing field returns 400 with the problem **against that field** and creates no record
- [X] T059 [P] [US4] **E2E double-submit spec in `tests/e2e/admin-double-submit.spec.ts` — assert two concurrent identical requests create EXACTLY ONE record.** This is the single most important test in the suite (FR-014, SC-007). Run against a sandbox workflow, never production

### Implementation for User Story 4

- [X] T060 [US4] Implement `POST /api/admin/new-hire` in `src/app/api/admin/new-hire/route.ts` — validate with the shared `adminRequestSchema`, return 503 while `ADMIN_CONTRACT_VERIFIED` is false, and add an **in-flight mutex keyed by a client-generated request id** so one submission cannot create two records
- [X] T061 [P] [US4] Build `ProvisionalHireForm` in `src/components/new-hire/ProvisionalHireForm.tsx` using React Hook Form + `zodResolver` against the **same schema** the route imports — inline per-field validation, form locks and `aria-busy` on submit
- [X] T062 [P] [US4] Build `ProvisioningResultCard` in `src/components/new-hire/ProvisioningResultCard.tsx` — shows the created `temp_emp_id` with a direct link to that employee's tracker
- [X] T063 [US4] Build `/new-hire` in `src/app/new-hire/page.tsx` — **renders nothing but an explanatory notice while the flag is off**
- [X] T064 [US4] Document the confirmed contract in `specs/001-people-ops-portal/contracts/upstream-integrations.md`, removing the PROVISIONAL marker and updating `src/lib/contracts/adminRequestSchema` — **one file changes once the real field set is known**

**Checkpoint**: US1–US4 work independently. US4 is not deployable until unblocked.

---

## Phase 7: User Story 5 — Responsive Across Phone, Tablet, Desktop (Priority: P5)

**Goal**: Every primary journey is fully operable at 360px with no horizontal scrolling.

**Independent Test**: Complete every P1–P4 journey at 360px and confirm controls remain reachable.

> **Note**: This phase is applied **across** US1–US4 rather than deferred to the end. Responsive
> defects are cheapest to fix in the component that introduces them.

### Tests for User Story 5 ⚠️

- [X] T065 [P] [US5] E2E responsive spec in `tests/e2e/responsive.spec.ts` — at 360px, 768px, and 1280px assert `scrollWidth <= clientWidth` on every route, and that no text is clipped or truncated unreadably (SC-006, FR-027)
- [X] T066 [P] [US5] E2E touch-target spec in `tests/e2e/touch-targets.spec.ts` — assert every interactive target is ≥44×44px at touch widths (FR-028)
- [X] T067 [P] [US5] E2E mobile-card spec in `tests/e2e/responsive-cards.spec.ts` — assert tables below `md` render as stacked cards, **not** as a horizontally scrolled table

### Implementation for User Story 5

- [X] T068 [P] [US5] Create the responsive table primitive in `src/components/ui/ResponsiveTable.tsx` — renders a real `<table>` above `md` and the identical row model as stacked label/value cards below, driven by one column definition via `useMediaQuery`
- [X] T069 [US5] Build the collapsible navigation drawer in `src/components/layout/NavDrawer.tsx` — 248px fixed sidebar above `lg`, overlay drawer below
- [X] T070 [US5] Apply the responsive primitive to `EmployeeTable`, `WelcomeStatusTable`, and any filter bar, replacing any horizontal-scroll fallback
- [X] T071 [US5] Verify every route renders correctly at 360px, 768px, and 1280px and fix layout defects found

**Checkpoint**: All five stories responsive and independently functional.

---

## Phase 8: Dashboard & Cross-Cutting Polish

**Purpose**: Dashboard composition plus improvements spanning multiple stories.

- [X] T072 [P] Build `GET /api/health` in `src/app/api/health/route.ts` probing both n8n and the sheet, returning `{status, n8n:{reachable,checkedAt}, sheet:{reachable,ageSeconds,checkedAt}}`
- [X] T073 [P] Build the dashboard in `src/app/page.tsx` — four KPI tiles, cohort distribution, an **attention queue** of hires with overdue outstanding items, and a system-health panel showing ingestion freshness (FR-020)
- [X] T074 [P] Build the `/design-system` route in `src/app/design-system/page.tsx` importing every component in all five states plus the three tracker states and the policy `unanswered` state — cheaper than Storybook and tests the same invariants
- [X] T075 Add accessibility audit in `tests/e2e/a11y.spec.ts` — assert status is never conveyed by color alone (FR-029) and that text meets WCAG AA contrast (FR-030)
- [X] T076 [P] Add E2E authorization spec in `tests/e2e/authz.spec.ts` — `new_hire` gets 403 on `/api/tracker` and `/api/admin/new-hire`; `manager` gets 403 outside their reporting line. Assert **direct route invocation**, not nav absence
- [X] T077 [P] Add PII-leak test in `tests/unit/pii.test.ts` — assert the serializer is an **allowlist** by adding a `salary` column to the test sheet and confirming it appears in no response. Written to FAIL if the serializer is ever changed to a denylist
- [X] T078 [P] Add audit-ordering test in `tests/unit/audit.test.ts` — force the audit write to fail, assert the read **fails** rather than serving unlogged PII; assert `actor_email` cannot be client-supplied
- [X] T079 [P] Implement the upstream contract probe script at `scripts/probe-upstreams.ts` asserting the six probes in quickstart.md Scenario 1 still match — the three-state and empty-answer traps drift silently
- [X] T080 [P] Add the integrity check script at `scripts/check-upstreams.ts` wired to `npm run check:upstreams`
- [X] T081 Run the full validation suite from quickstart.md: `npm run check:upstreams && npm run lint && npm run typecheck && npm test && npm run test:e2e`
- [X] T082 Verify the four release gates from plan.md: zero blank-panel failures, zero grounding failures, zero PII leaks, zero unauthorized disclosures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **User Stories (Phases 3–7)**: All depend on Phase 2 completion; then parallel if staffed
- **Polish (Phase 8)**: Depends on the desired stories being complete

### User Story Dependencies

All stories are independently completable after Phase 2:

- **US1 (P1)**: No dependencies on other stories. **Sequences the rest** — it validates the whole data layer.
- **US2 (P2)**: Independent. Shares only the `policyResponseSchema` from Phase 2.
- **US3 (P3)**: Independent. Smallest surface.
- **US4 (P4)**: Independent but **externally blocked** on contract confirmation (T064).
- **US5 (P5)**: Applied across US1–US4. Its tests (T065–T067) need at least one story rendering.

### Critical Path

```
T001–T008 (Setup)
  → T009–T025 (Foundational)
    → T026–T040 (US1) ← MVP, everything else reuses its fan-out pattern
      → T041–T048 (US2)
        → T049–T055 (US3)
          → T056–T064 (US4) — externally blocked at T064
            → T065–T071 (US5)
              → T072–T082 (Polish)
```

### Parallel Opportunities

- T003–T008 in Phase 1 (6 parallel)
- T012, T013, T017, T018, T021, T022, T023, T025 in Phase 2 (8 parallel)
- T026–T030 tests in US1 (5 parallel)
- T034–T036 in US1 (3 parallel)
- T041–T043 in US2, T045–T046 + T048, T049–T050, T053–T054, T056–T059, T061–T062, T065–T067
- Entire stories can be worked in parallel once Phase 2 clears

---

## Parallel Example: User Story 1

```bash
# All US1 tests together (written first, must fail):
Task: "Unit test per-row quarantine in tests/unit/ingest.test.ts"
Task: "Unit test mixed-type coercion in tests/unit/preprocess.test.ts"
Task: "Unit test the three-state classifier in tests/unit/classify.test.ts"
Task: "E2E no-blank-panel spec in tests/e2e/tracker.spec.ts"
Task: "E2E partial-failure spec in tests/e2e/tracker-partial-failure.spec.ts"

# Then implementation, in dependency order:
Task: "Implement GET /api/tracker in src/app/api/tracker/route.ts"   # depends on T013, T016, T018
Task: "Build the tracker table in src/components/tracker/EmployeeTable.tsx"  # [P]
Task: "Build ProgressRing and ProgressBar in src/components/tracker/"        # [P]
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — **blocks everything**
3. Phase 3: US1 (tracker)
4. **STOP and VALIDATE** — run quickstart.md Scenarios 1, 2, 3, 5
5. Deploy/demo

The MVP delivers the highest-value capability: visibility into where every new hire stands.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. **US1** → validate Scenarios 1–3 → deploy (MVP)
3. **US2** → validate Scenario 4 → deploy
4. **US3** → validate → deploy
5. **US5** → validate Scenario 9 → deploy
6. **US4** → validate Scenario 8 → deploy **only after unblock**
7. Polish + release gates

### Parallel Team Strategy

After Phase 2 clears:

- Developer A: US1 (tracker) — start immediately
- Developer B: US2 (policies) — independent
- Developer C: US3 (welcome) then US5 (responsive)

US4 waits on contract confirmation, not on team capacity.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps each task to a user story for traceability
- Each story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- **Every module ships with all five data states complete** — a partial-state module fails the constitution's observability obligations
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence

### Risks Carried Into Execution

These are tracked in plan.md §Complexity Tracking and must not be quietly skipped:

| # | Item | Blocks |
|---|---|---|
| 1 | `admin` contract unverified | T060–T064, Scenario 8, SC-007 |
| 2 | Progress never persisted to the sheet | Principle III compliance — workflow or constitution decision |
| 3 | Sheet publicly readable | **Security posture — action before deployment** |
| 4 | No delete path | No delete affordance in UI until n8n soft-delete exists |
| 5 | Stage vocabulary owned by workflow | T009 enum ordering, T033 monotonic guard |
| 6 | `total_items` vs `total_essentials` mismatch | T040 |
| 7 | Malformed row in live sheet | T016 quarantine; HR cleanup, app never repairs |
| 8 | Principle I deviation unrecorded | Governance — needs a sanctioned exception or amendment |

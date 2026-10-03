# Implementation Plan: People Operations Portal

**Branch**: `001-people-ops-portal` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-people-ops-portal/spec.md`

## Summary

A responsive, mobile-ready React front end for an internal People Operations portal that lets HR
and new hires see where onboarding actually stands. It is a BFF-backed Next.js application over four
existing n8n webhooks, with a Google Sheet remaining the single source of truth. No application
database is introduced.

The technical approach rests on four verified findings rather than assumptions: the `onboarding-progress`
webhook has no list mode (so the tracker is a server-side fan-out); `policy` can return
`status: "success"` with an empty `answer`; `onboarding-progress` returns HTTP 200 for success,
not-found, and error alike; and the sheet is link-shared and publicly readable. Each of these
shapes the contract layer, and three of them are invisible without probing first.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22 LTS

**Primary Dependencies**: Next.js 16 (App Router), React 19, TanStack Query v5, TanStack Table v8,
React Hook Form, Zod, Tailwind CSS v4, shadcn/ui (as copy-paste source)

**Storage**: Google Sheets as the single source of truth. No application database. One data sheet
(read), one audit sheet (append-only), in-process TTL cache for derived reads.

**Testing**: Vitest + React Testing Library (unit), Playwright (E2E, Chromium only)

**Target Platform**: Web — phone (360px minimum), tablet, desktop. Self-hosted Node container.

**Project Type**: Web application with an integrated BFF

**Performance Goals**: First contentful paint under 1.5s on desktop; tracker row hydration visible
per-row as it lands rather than blocked on the slowest employee; policy answer under 2s end to end;
data age always displayed.

**Constraints**: No browser-side write credentials to the sheet. No PII in any response. All writes
terminate at n8n. Credentials server-side only. `admin` contract unverified, so provisioning ships
feature-flagged off.

**Scale/Scope**: Tens to low hundreds of employees. Internal HR tool. 6 routes, ~4 feature modules.
Not enterprise scale, and the plan deliberately rejects enterprise defaults that do not earn their
cost here.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Re-evaluated after Phase 1. All gates pass.

| Principle | Obligation | Plan response | Status |
|---|---|---|---|
| I. Conversational | Conversation is the interface | Deliberate deviation: a portal, not a chat UI | **Documented deviation** — see Complexity Tracking |
| II. Grounded in Company Truth | No invented content; cite sources | Policy answers always carry `source`; empty answers render as `unanswered` with a human path; the workflow's refusal is shown verbatim | PASS |
| III. One Source of Truth | No duplicate representations | Sheet remains authoritative; progress derived from the workflow and never written to a second store; every task resolves to a canonical employee record | PASS |
| IV. Complete & Actionable | Every visible task is actionable | Progress is shown as explicit completed/outstanding lists with a stage-update control gated on `can_update_stage` | PASS |
| V. Freshness & Honest Uncertainty | No stale data presented as current | Every response carries `rosterFreshness`; polling countdown is displayed; ingestion gaps are logged as data-source limitations, not silently defaulted | PASS |
| Knowledge Sources | No two connectors own one entity | Ingest pins `Sheet1!A1:J`; the Sheet2 mirror is explicitly excluded to prevent double-counting | PASS |
| Security & Privacy | Least privilege; no PII; audit | Service account in the n8n tier only; authorization precedes fetch; serializer uses an allowlist; audit row written **before** disclosure | PASS |
| Workflow & Quality Gates | Grounded-answer and refusal accuracy gate releases | Quickstart Scenarios 3, 4, 6, 7 are release gates | PASS |

**Gate result: PASS**, with one documented deviation (principle I) and one constitutional conflict
that cannot be resolved by code (recorded under Complexity Tracking).

### Two findings that require a decision outside this codebase

1. **Principle III vs. the sheet.** The constitution requires a single canonical record per task.
The sheet is that record. `onboarding_stage` is a chips column that **did** persist values
   (`Not Started`, `In Progress`, `Completed`) on 2026-10-02 and was blanked the same day by the
   `onboarding-progress` workflow, which contains a googleSheets node that writes an empty string
   to it on any read that omits the field. `completed_essentials` is a formula over that column, so
   it blanked with it. Separately, `onboarding-progress` derives progress from four checklist
   columns (`IT_ticket`, `task_complete`, `meet_and_greet_with_team`, `onboarding_status`) that
   **do not exist** in `Sheet1`, so its `total_items` is a hardcoded `4` and completion is always
   `0/4`. There is therefore **no reliable single source of truth for progress**. This is not a UI
   bug and no front-end code can fix it. Either the workflow must persist progress and stop writing
   on read, or the constitution must be amended. Flagged, not silently
   papered over.

2. **The sheet is publicly readable.** It is link-shared; its CSV exports unauthenticated. That is a
   live PII exposure for real employee names, work emails, and start dates, and it sits directly
   against the constitution's access-boundary section. Quickstart and research both specify the
   hardening. It should be actioned before the portal is deployed, not after.

## Project Structure

### Documentation (this feature)

```text
specs/001-people-ops-portal/
├── plan.md                          # This file
├── spec.md                          # Feature specification
├── research.md                      # Phase 0 — all clarifications resolved
├── data-model.md                    # Phase 1 — entities, validation, relationships
├── quickstart.md                    # Phase 1 — runnable validation scenarios
├── checklists/
│   └── requirements.md              # Spec quality checklist
├── contracts/
│   ├── bff-api.md                   # BFF routes and response contracts
│   └── upstream-integrations.md     # Observed n8n + Sheets behavior
└── tasks.md                         # Phase 2 — /speckit.tasks (not created here)
```

### Source Code (repository root)

Greenfield. No application source exists yet.

```text
src/
├── app/
│   ├── layout.tsx                   # Shell, session, navigation
│   ├── page.tsx                     # Dashboard
│   ├── design-system/page.tsx       # All components, all five states
│   ├── tracker/
│   │   ├── page.tsx                 # Fan-out tracker
│   │   └── [id]/page.tsx            # Employee detail
│   ├── welcome/page.tsx
│   ├── policies/page.tsx
│   ├── new-hire/page.tsx            # Feature-flagged off
│   └── api/                         # BFF — credentials never cross this boundary
│       ├── tracker/route.ts
│       ├── tracker/[id]/route.ts
│       ├── tracker/[id]/stage/route.ts
│       ├── policies/search/route.ts
│       ├── welcome/route.ts
│       ├── welcome/[id]/route.ts
│       ├── admin/new-hire/route.ts
│       └── health/route.ts
├── components/
│   ├── ui/                          # shadcn, retargeted to our tokens
│   ├── data-state/                  # The five-state wrapper + blank-panel invariant
│   ├── tracker/                     # ProgressRing, StatusBadge, OutstandingList
│   ├── policies/                    # AnswerCard, UnansweredCard
│   └── welcome/
├── lib/
│   ├── contracts/                   # Zod schemas, shared client ↔ BFF
│   ├── n8n/                         # Webhook client — timeout, retry, status branching
│   ├── sheets/                      # Ingest, per-row safeParse, quarantine, ETag cache
│   ├── auth/                        # Session, role gate, scope check
│   ├── audit/                       # Append-only audit writer
│   └── flags.ts                     # ADMIN_CONTRACT_VERIFIED
├── styles/
│   └── globals.css                  # Token single source of truth
└── types/
    └── domain.ts                    # RowResult, PolicyResponse, Stage

tests/
├── fixtures/                        # Real observed payloads, incl. all three edge shapes
├── unit/                            # ingest, contracts, serializer, audit
└── e2e/                             # Playwright: blank-panel, grounding, authz, responsive
```

**Structure decision**: a single Next.js application, not a split frontend/backend. The BFF must
sit in the request path to hold credentials and authorize before fetching, and the `NEXT_PUBLIC_`
boundary enforces that. Splitting into two deployables would create two origins and a hand-rolled
credential server for an internal tool with one team.

## Build Sequence

Derived from spec priorities and validated contract density.

1. **Foundation** — Zod contracts, n8n client, sheet ingest with quarantine, ETag cache, session +
   role gate, audit writer, `DataState` wrapper.
2. **`/tracker` (P1)** — the fan-out aggregator and the discriminated-union row result. Validates
   the entire data layer; everything else reuses it.
3. **`/policies` (P2)** — search-only, with the full three-way answer classification.
4. **`/welcome` (P3)** — smallest surface; validates idempotent-success handling.
5. **Dashboard** — composed from tracker data; no new backend work.
6. **`/new-hire` (P4)** — blocked on contract confirmation; ships flagged off.
7. **Responsive pass (P5)** — applied across 1–6, not deferred to the end.

Every module ships with all five data states complete. A module with partial states fails the
constitution's observability obligations.

## Complexity Tracking

### Deviation 1 — Portal UI instead of a conversational interface

**Constitution principle I** requires that conversation be the interface and that no feature exist
only as a form or dashboard.

**Deviation**: this feature is a structured portal across six routes.

**Why needed**: the user's stated request is an executive dashboard, four functional modules, and a
responsive website. A conversational shell would serve a different product than the one requested.

**Simpler alternative rejected because**: principle I is not a complexity constraint — it is a
product judgment. Adopting it here would override an explicit user request rather than simplify
the work. The principles that survive translation to a portal — grounding, provenance, freshness,
completeness, least privilege, and no fabrication — are all enforced above.

**Recommended follow-up**: amend principle I to scope it to conversational surfaces, or explicitly
record this portal as a sanctioned exception with an expiry date. Leaving it unrecorded means the
next reviewer reads a live violation.

### Complexity 2 — Server-side fan-out aggregator

Not in the constitution, but a deliberate cost.

**Why needed**: `onboarding-progress` has no list mode, so a tracker of N employees is N upstream
calls. Issuing those from the browser means N round trips per user per poll.

**Simpler alternative rejected because**: client-side fan-out was rejected as the primary path
(every open tab re-hammers n8n, and partial failure handling gets duplicated in every component),
not because it is harder — it is simpler. The aggregator is justified by fan-out control and the
`allSettled` partial-failure guarantee, and is retained deliberately.

### Complexity 3 — No versioning column for concurrent writes

**Why needed**: two HR admins can advance the same employee's stage, and the Sheets API does not
honor `If-Match`, so true compare-and-swap is unavailable.

**Simpler alternative rejected because**: a `version` column plus read-check-write is real
engineering against a failure whose worst outcome — one redundant write — is already absorbed by the
monotonic stage guard. Revisit only if concurrent-edit complaints appear.

### Open items requiring decisions outside this codebase

| # | Item | Blocks | Owner decision |
|---|---|---|---|
| 1 | `admin` required field set unverified | P4 provisioning, SC-007 | Inspect the workflow; no dry-run exists |
| 2 | Progress never persisted to the sheet | Principle III compliance | Workflow change **or** constitution amendment |
| 3 | Sheet is publicly readable | Security posture | Restrict sharing; share with service account as Viewer |
| 4 | No delete path | Mis-provisioned record removal | Add soft-delete via n8n; UI shows no delete affordance |
| 5 | Stage vocabulary owned by workflow | Monotonic guard ordering | Confirm canonical enum; map drift in the BFF serializer |
| 6 | `total_items: 4` vs `total_essentials: 3` | Progress display accuracy | Reconcile; display webhook figure and flag discrepancy |
| 7 | Malformed row in live sheet | Data cleanliness | HR cleanup — the app quarantines, never repairs |
| 8 | Principle I deviation | Governance | Record as sanctioned exception or amend |

Item 8 is the one that will resurface at the next review if left unrecorded.

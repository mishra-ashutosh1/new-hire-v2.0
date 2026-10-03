# People Operations Portal — Technical Blueprint & Design System

**Status:** Architectural proposal
**Date:** 2026-10-02
**Scope:** Front-end layer over four n8n webhooks, with a Google Sheet as the single source of truth.

---

## 0. Verified Integration Contracts

Everything in this document is based on live probes against the actual endpoints and the actual
spreadsheet. These are the observed facts the UI must be built against.

### 0.1 Transport

| Endpoint | GET | POST | Notes |
|---|---|---|---|
| `/webhook/admin` | 404 | 400 on invalid body | Webhook is POST-only. Rejects `{}`. |
| `/webhook/onboarding-progress` | 404 | 200 | Requires `temp_emp_id`. |
| `/webhook/welcome` | 404 | 200 / 500 | Requires `temp_emp_id`. |
| `/webhook/policy` | 404 | 200 / 400 | Requires `question`. |

**Implication:** the client must never issue a `GET`. Every call is `POST` with a JSON body. The
GET 404 is n8n's default webhook behavior, not an outage — the UI must not surface it as an error
state.

### 0.2 `onboarding-progress` — the richest contract

Request:
```json
{ "temp_emp_id": "1201" }
```

Response (observed, employee 1201):
```json
{
  "status": "success",
  "temp_emp_id": "1201",
  "name": "Ashish Kumar",
  "role": "Developer - Lead",
  "onboarding_stage": "",
  "onboarding_status": "welcome_sent",
  "percent_complete": 0,
  "completed_count": 0,
  "total_items": 4,
  "completed": [],
  "outstanding": [
    "IT ticket closed",
    "Onboarding task completed",
    "Meet & greet with team",
    "Onboarding status confirmed"
  ],
  "can_update_stage": true,
  "requested_stage_update": false,
  "message": "Onboarding progress retrieved for 1201."
}
```

Error shape (unknown id) — note this is **HTTP 200**, not 404:
```json
{ "status": "not_found", "message": "No onboarding record found for does-not-exist-zzz.", "temp_emp_id": "..." }
```

Validation shape — HTTP 200 with an error status:
```json
{ "status": "error", "message": "temp_emp_id is required" }
```

`onboarding_stage` was accepted on a read request and the payload exposes `can_update_stage` and
`requested_stage_update`, so stage writes flow through this same endpoint.

**UI implication:** status must be branched on the `status` field, not the HTTP code. Three
distinct outcomes (success / not_found / error) all arrive as HTTP 200. Rendering these
identically would show "no record" for what is actually "you forgot to pass an id."

### 0.3 `policy`

Request:
```json
{ "question": "remote work" }
```

Responses observed:
```json
{ "status": "success", "answer": "", "source": "hr_document.md" }
{ "status": "success", "answer": "The policy does not provide enough information to answer this question. Please contact People Operations.", "source": "hr_document.md" }
```

**Critical finding:** the workflow can return `status: "success"` with an **empty answer string**.
This is the single most dangerous response shape in the whole system — a naive UI renders a blank
card and the employee concludes the policy is unavailable for every topic, or worse, a loading
skeleton that never resolves and is read as "still loading."

The UI MUST treat an empty `answer` as a distinct `unanswered` state, render it as an explicit
"no policy covers this" card, and route to People Operations. It must never fall through to the
generic "no results" treatment.

`source` is a filename, not a URL. It cannot be hyperlinked as-is. The UI shows it as provenance
text; if deep-linking is wanted, a source registry maps filename → canonical document URL. That
mapping is a governance artifact and belongs in the constitution's "one source of truth" scope.

### 0.4 `welcome`

```json
{ "status": "already_sent", "message": "Welcome email has already been sent for this employee.", "email_sent": false }
```

`already_sent` is **idempotent success**, not an error. The employee is already provisioned for
welcome; re-sending is correct behavior to prevent. The UI shows a confirmed-green state, never a
warning-red one. Unknown or malformed ids produce HTTP 500, which the UI maps to a retryable error
with the id echoed back.

### 0.5 `admin`

The endpoint rejects `{}` and `{"name":"probe"}` with 400 and no body. The required field set was
not recoverable without triggering a real hire, so it is not guessed here. **Required fields must
be confirmed against the workflow before the form is built.**

Inferred from the sheet's column set and the onboarding tracker, the expected payload is:

| Field | Type | Sheet column |
|---|---|---|
| `name` | string | `name` |
| `role` | string | `role` |
| `start_date` | `YYYY-MM-DD` | `start_date` |
| `emailID` | email | `emailID` |
| `cohort` | integer | `cohort` |

`temp_emp_id` is **supplied by the client** and must appear in the form. This corrects an earlier
claim here that it was workflow-generated: the live workflow's `Validate New Hire1` node errors
with `temp_emp_id is required` when it is absent. `total_essentials` is also client-supplied, not
workflow-computed.

**Contract status:** the admin contract was **confirmed 2026-10-02** against that node's source.
The form still ships disabled, but now behind a deployment flag rather than a safety rail — and it
should stay off until the form actually collects `tempEmpId`, since the endpoint creates real records
with no dry run.

### 0.6 Google Sheet — verified schema

Sheet ID `1FoGZrSYydXmoHnMLfNdqlGa1GOpHdqvwLGOHW8XQz5o`, currently published (link-shared,
readable without auth).

Two tabs exist. **Sheet1 (gid 0) is live data. Sheet2 (gid 1) is a byte-identical mirror** — this
is almost certainly an n8n read-then-write mirror or a backup target, not a second source of truth.
The portal reads Sheet1 only.

Columns and observed data:

| Column | Observed values | Notes |
|---|---|---|
| `temp_emp_id` | `1201`, `1202`, blank | Mixed text/number. **Type bug.** |
| `name` | `Ashish Kumar`, `Test User Production` | |
| `role` | `Developer - Lead`, `QA Engineer` | |
| `start_date` | `2026-09-30`, `2026-10-01` | ISO strings, not serial dates |
| `cohort` | `3`, `4`, blank | Mixed text/number |
| `emailID` | `acm5520@gmail.com` | |
| `total_essentials` | `3`, `4` | |
| `completed_essentials` | derived | Live formula `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))` — counts the chips in column I, so it is never independent data |
| `onboarding_stage` | multi-value chips | Coarse labels (`Not Started` / `In Progress` / `Completed`), possibly comma-joined |
| `welcome_status` | `welcome_sent` | Only value observed. Welcome-EMAIL state, not onboarding progress |

Column J is **`welcome_status`**. There is no `onboarding_status` column in `Sheet1`; that name is
invented by the `onboarding-progress` workflow's checklist and is why it always reports `0/4`.

Three data-quality findings that shape the UI:

1. **Row 3 is test garbage** â€” `fafsa`, `fasfsa`, `fsafa@gma.com`, `fasfsa` as a role. It will
   appear in every dashboard. The UI filters malformed rows; the sheet needs manual cleanup.
2. **`temp_emp_id` and `cohort` are mixed-typed.** A blank `temp_emp_id` exists. This breaks
   numeric comparison, sorting, and join keys. The client MUST coerce and validate on read.
3. **`onboarding_stage` was blanked on 2026-10-02, and reading it used to be destructive.**
   It previously held chips (`Not Started`, `In Progress`, `Completed`) and was wiped because the
   `onboarding-progress` workflow contained an active googleSheets node that wrote an **empty
   string** to the column on any read that omitted the field. Because column H is a formula over
   column I, `completed_essentials` blanked with it. `GET /api/tracker` issued one such read per
   employee every 30s, so its fan-out shipped behind the `TRACKER_PROGRESS_FANOUT` flag, **default
   off**. **As of 2026-10-03 that node is gated behind `requested_stage_update`**, the gate is proven
   (a plain read leaves a non-empty stage intact), and the fan-out is enabled — column I was
   byte-identical before and after a real 4-row `GET /api/tracker`. The flag remains as a kill
   switch. The data is still not restored: column I needs sheet version history.

**`completed_essentials` empty while `onboarding-progress` reports `percent_complete: 0` and a
full `outstanding` list** means the sheet and the webhook disagree about whether progress is
tracked. The tracker must render from the webhook payload, not from the sheet's progress columns,
and treat the sheet's progress columns as unimplemented.

---

## 1. Design System & Visual Identity

### 1.1 Design principles

**Calm, not decorative.** This is a tool people open on day one of a job, often while anxious.
Dense, high-contrast data beats whitespace-heavy marketing layouts. Every pixel of visual weight
must encode information.

**Status is the primary visual language.** Onboarding is a state machine. Color is reserved
almost entirely for status encoding and is spent nowhere else.

**Progressive disclosure.** Two-week onboarding is intimidating. Show the next three actions
prominently and collapse the rest behind expansion.

**Honest emptiness.** Every empty, error, and unknown state gets a designed treatment. A blank
panel reads as broken. This system is audited against that failure mode — see §0.3.

### 1.2 Color palette

Base is a deep slate neutral ramp. Status hues are desaturated enough to coexist without
competing, and every one meets WCAG AA (4.5:1) against its intended background.

**Neutral ramp — "Slate"**
| Token | Value | Use |
|---|---|---|
| `--surface-canvas` | `#0B0F17` | App background |
| `--surface-raised` | `#131926` | Cards, panels |
| `--surface-overlay` | `#1C2434` | Modals, popovers, dropdowns |
| `--surface-input` | `#0F1520` | Input fields |
| `--border-subtle` | `#232D3E` | Dividers, table rules |
| `--border-strong` | `#33415A` | Input borders, focus rings |
| `--text-primary` | `#F0F4FA` | Headings, primary body |
| `--text-secondary` | `#9AA9BF` | Labels, metadata |
| `--text-tertiary` | `#64748B` | Disabled, placeholders |

**Brand accent — "Signal"** (single accent; used for primary action and focus only)
| Token | Value | Use |
|---|---|---|
| `--accent-500` | `#4F8CFF` | Primary buttons, links, active nav |
| `--accent-400` | `#6FA1FF` | Hover |
| `--accent-600` | `#3A72DB` | Active/pressed |
| `--accent-glow` | `rgba(79,140,255,0.16)` | Focus ring, subtle wash |

**Status hues** — one per onboarding state, each with a matching low-alpha background for badges
| Token | Value | Semantic |
|---|---|---|
| `--success` | `#34D399` | Task complete, welcome sent, record found |
| `--warning` | `#FBBF24` | Due soon, blocked, partial progress |
| `--danger` | `#F87171` | Overdue, failed workflow, form validation error |
| `--info` | `#60A5FA` | In progress, pending action |
| `--neutral-status` | `#94A3B8` | Not started, blocked-by-dependency |
| `--unknown` | `#A78BFA` | No source, unanswered, staleness warning |

`--unknown` is a deliberate addition. Policy questions with no source coverage get their own
hue rather than being folded into danger or neutral, because "we genuinely don't know" is
categorically different from "something failed."

**Accent discipline:** exactly one accent hue, used for primary actions. Status hues are never
used for navigation, and the accent is never used for status. This single rule is what keeps a
data-dense interface from becoming unreadable.

### 1.3 Typography

Two families. `Inter` for all UI — variable font, tabular numerals enabled globally so progress
figures and table columns align. `JetBrains Mono` for identifiers (`temp_emp_id`), ISO dates, and
JSON payloads, so machine-generated values are visually distinct from human-authored ones.

**Type scale** — 1.200 minor third, base 14px for density.

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `--text-display` | 34 / 40 | 600 | Dashboard hero metric |
| `--text-h1` | 26 / 32 | 600 | Page titles |
| `--text-h2` | 20 / 28 | 600 | Section headings |
| `--text-h3` | 16 / 24 | 600 | Card titles, employee names |
| `--text-body` | 14 / 21 | 400 | Body, table cells |
| `--text-sm` | 13 / 19 | 400 | Secondary content |
| `--text-caption` | 12 / 16 | 500 | Labels, timestamps |
| `--text-micro` | 11 / 14 | 600 | Badges, uppercase eyebrows |

Letter-spacing: `-0.011em` at display/h1, `-0.006em` at h2/h3, `0` at body, `+0.04em` uppercase at
caption/micro. Eyebrows are `text-micro` uppercase with `+0.04em`.

### 1.4 Spacing, grid, and shape

4px base. Scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80`.

**Layout grid:** 12 columns, 24px gutter, 24px page margin, max content width 1440px. Breakpoints:
`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Sidebar 248px fixed, collapses to an overlay
drawer below `lg`.

**Radii:** `--radius-sm 6px` (badges, inputs), `--radius-md 10px` (cards, buttons),
`--radius-lg 14px` (modals, panels), `--radius-full` (avatars, progress bars).

**Elevation** — dark UI needs light-based shadows, not black:
```
--shadow-sm:  0 1px 2px rgba(0,0,0,0.30)
--shadow-md:  0 4px 12px rgba(0,0,0,0.36)
--shadow-lg:  0 16px 40px rgba(0,0,0,0.48)
```

**Motion:** 120ms for hover/press, 200ms for panel and modal transitions, 320ms for progress
animations. Easing `cubic-bezier(0.2, 0, 0, 1)`. Honors `prefers-reduced-motion` — progress bars
snap to their final value instead of animating.

### 1.5 Component inventory

**Buttons** — three variants, four sizes.
`primary` (accent fill, `--text-primary` label), `secondary` (`--surface-overlay` fill, subtle
border), `ghost` (transparent, hover fill). All: 8px radius, 500 weight, 500ms active scale
transition. `danger` variant for destructive confirm. Every button carries `aria-busy` while its
mutation is in flight and MUST disable itself to prevent double submission — the admin form
creates a real hire and a double POST creates two.

**Inputs** — `--surface-input` fill, `--border-strong` border, 8px radius, 36px default height.
Focus: 2px `--accent-glow` ring plus border shift to `--accent-500`. Error: `--danger` border with
a 12px caption below, `aria-invalid` and `aria-describedby` wired. Labels always visible above the
field — no placeholder-only labeling.

**Cards** — `--surface-raised`, 1px `--border-subtle` border, `--radius-lg`, 24px padding.
Optional `--shadow-md` on hover for interactive cards only. Interactive cards get a visible
`:focus-visible` ring and full keyboard activation.

**Status badges** — `text-micro` uppercase in a `hsl(var(--status) / 0.14)` background with the
full-saturation status color as text, 999px radius, 4px 8px padding. Every badge is paired with an
icon or text label; color is never the sole carrier of meaning (WCAG 1.4.1).

**Progress** — a 6px track with a `--accent-500` fill and an animated shimmer during in-flight
updates. Paired with a numeric percentage and a `completed / total` count. A conic-gradient ring
variant for the hero metric on the dashboard.

**Tables** — sticky header, 48px rows, `--surface-raised` zebra at 4% white, hover `--surface-overlay`.
Sortable columns with directional chevrons. Every table has a designed empty state and a designed
error state.

**Data states — the required component.** Every async surface implements five states, and no
component ships with fewer:
1. `idle` — nothing requested yet, with a prompt to act
2. `loading` — skeleton matching final layout dimensions, never a spinner alone
3. `empty` — no records, with the reason and the next action
4. `error` — what failed, the id or field involved, a retry button, and the raw message
5. `success` — the payload, rendered in the domain's own vocabulary

---

## 2. Information Architecture & User Flow

### 2.1 Site map

```
/                      Executive Dashboard
├── /new-hire          Provision a new hire          → admin
├── /tracker           Onboarding Tracker            → onboarding-progress
│   └── /tracker/[id]  Employee detail
├── /welcome           Welcome Sequences            → welcome
└── /policies          Policy & Benefits Hub        → policy
```

### 2.2 Executive Dashboard (`/`)

The landing page answers "how is onboarding going across the company" in one screen.

- **Hero band** — four KPI tiles: active new hires, average `percent_complete`, items overdue,
  welcomes sent this week. Each tile drills into the filtered tracker.
- **Cohort distribution** — hires grouped by `cohort` as a horizontal bar set, since the sheet
  tracks cohort explicitly.
- **Attention queue** — the operational core: every hire with an outstanding item past due, sorted
  by severity. This is the panel an HR lead actually lives in, and it earns the top-right slot.
- **Recent activity** — timeline of provisioning, welcome, and stage-update events.
- **System health** — sheet sync freshness and n8n webhook reachability. Per the constitution's
  freshness principle, ingestion health is a first-class, always-visible surface, not a hidden
  admin page.

### 2.3 User flows

**Provision (HR admin)**
`/new-hire` → fill form → client validation → POST `admin` → pending state with the button
disabled → success card showing the returned `temp_emp_id` and a direct link to that employee's
tracker → optional "provision another."

**Monitor (HR admin / manager)**
`/tracker` → cohort and status filters → table → row click → `/tracker/[id]` → hero progress ring,
`completed` / `outstanding` lists, current stage, `can_update_stage` badge → stage update → confirm
→ refetch → progress animates. No manual refresh; polling (§4.3) keeps it current.

**Audit welcomes (HR admin)**
`/welcome` → table of hires with welcome status → row action → POST `welcome` → `already_sent`
renders a green "already provisioned" confirmation; `email_sent: true` renders "welcome sent just
now."

**Ask a policy question (anyone)**
`/policies` → search input → POST `policy` → answer card with `source` attribution. Empty `answer`
produces the `--unknown` card: "No policy covers this yet — ask People Operations." Never a blank
panel.

### 2.4 Roles

| Role | Access |
|---|---|
| HR Admin | All four modules, all employees |
| Manager | Tracker and Policies, scoped to direct reports |
| New hire | Own tracker record and Policies |

New hires never see `/new-hire` or `/welcome`. Authorization is enforced server-side; hiding
nav items is presentation, not access control.

---

## 3. Functional Integration Mapping

### 3.1 `/new-hire` → `POST /webhook/admin`

**Components:** `ProvisionalHireForm` (multi-field, inline validation, disabled pending contract
confirmation), `PendingSubmitButton`, `ProvisioningResultCard`, `ApiErrorBoundary`.

**Interaction:** inline per-field validation before submit. On submit, button enters `aria-busy`,
form locks, and a skeleton result area appears. 200 renders the success card with the new
`temp_emp_id` and a "view tracker" link. 400 renders the server message inline against the form,
never as a toast — the user needs to fix a field, not read a notification.

**Loading/success/error states:** five data states plus an explicit `unavailable` state until the
payload contract is confirmed. Double-submit prevention is a hard requirement, not a nicety.

**Note:** this endpoint creates a real employee record. There is no dry-run mode. Until the
required-field set is verified, the form is feature-flagged off.

### 3.2 `/tracker` → `POST /webhook/onboarding-progress`

**Components:** `ProgressRing` (hero), `ProgressBar` (row-level), `StatusBadge`, `FilterBar`
(cohort, status, completion threshold), `EmployeeTable`, `EmployeeDetail`, `StageUpdateControl`,
`OutstandingList`.

**Interaction:** the endpoint requires a `temp_emp_id`, so it does **not** return a list. There is no
bulk feed. This is the defining constraint of this module:

- Read the roster from the Google Sheet (authoritative employee list).
- Hydrate per-employee progress via the webhook.
- Because that is N requests, a bounded-concurrency batch runner (6 at a time) fires them on mount
  and on the polling interval, with per-row independent state.

A roster row shows its own skeleton until its payload lands; rows resolve independently so one
failure never blanks the table.

**The `status` branch is mandatory.** All three of `success`, `not_found`, and `error` return HTTP
200. The client branches on `status`:

| `status` | Rendering |
|---|---|
| `success` | Full progress card |
| `not_found` | Amber "No onboarding record — sheet and workflow disagree" row, flagged for HR |
| `error` | Red inline error with `message` and the id, plus retry |

Collapsing `not_found` into `error` would misdirect HR to retry a lookup that will never succeed.

**Stage update:** gated on `can_update_stage`. When false, the control renders disabled with the
reason. On `success`, the row is refetched and the progress bar animates to its new value — never
optimistically updated, since the workflow's computed state is authoritative.

**Polling:** visible employees poll every 30s, paused on tab blur and when the document is hidden,
with the countdown shown in the table header so the refresh is never silent.

### 3.3 `/welcome` → `POST /webhook/welcome`

**Components:** `WelcomeStatusTable`, `SendWelcomeButton`, `SendResultAlert`.

**Interaction:** audit view over sheet rows with a per-row send action. `already_sent` is the
expected steady state, so the table renders welcome status as a default column and the action
column is secondary — this is an audit tool, not a bulk-send console.

`already_sent` → green confirmation with the exact server message. `email_sent: true` → green
"Welcome sent." HTTP 500 → red error echoing `temp_emp_id` with retry.

### 3.4 `/policies` → `POST /webhook/policy`

**Components:** `PolicySearchBar` (debounced 400ms), `AnswerCard`, `SourceAttribution`,
`UnansweredCard`, `SuggestedQuestions`.

**Interaction:** search box with suggested starter questions (leave policy, benefits enrollment,
remote work, equipment). Each query POSTs and renders an `AnswerCard` with the answer text and
`source` attribution.

**The empty-answer path is the critical branch.** A `success` response with an empty `answer`
renders `UnansweredCard` in `--unknown`: an explicit statement that no policy covers the topic,
plus the People Operations contact path. It must be visibly different from both a loading state and
a server error, because "nobody has written this down yet" and "the request failed" call for
completely different responses from the reader.

The workflow's own phrasing ("The policy does not provide enough information to answer this
question") is rendered verbatim rather than paraphrased, so the employee sees the actual source
behavior instead of a UI-rewritten claim.

**Category browse:** the endpoint has no list mode — probes for `query`, `search`, `category`,
`topic`, and `action` all returned 400. Only `question` is accepted. Categorized browsing therefore
requires either a source registry mapping documents to categories or a new n8n list mode. Until one
exists, the hub is search-only and the UI must not present category filters that cannot work.

---

## 4. Data Synchronization Strategy

### 4.1 Architectural stance

**All mutations flow browser → n8n → Sheet. The browser never writes to the Sheet.**

The sheet is link-shared (verified: its CSV exports unauthenticated), so anyone holding the URL has
full read access. A service account key in the browser would expose write access to the whole
sheet to every employee. This is the exact scenario the constitution's access-boundary section
prohibits, so the write path terminates at n8n, which holds the credential and validates before
touching the sheet.

```
Browser ──▶ Next.js BFF ──▶ n8n webhook ──▶ Google Sheet   (writes)
   │             │                │
   │             │                └──▶ Google Sheet        (reads, service account)
   └─────────────┴─── Google Sheets API (read-only, cached)
```

**BFF responsibilities:** hold n8n and Sheets credentials server-side, validate payloads against a
schema before forwarding, enforce role-based authorization per request, rate-limit and batch
webhook calls, cache reads, and normalize the mixed-typed sheet columns into typed DTOs.

The BFF is not optional plumbing. It is where the constitution's authorization and least-privilege
obligations are actually enforced — server-side, before any data is fetched, never by filtering
text after the model has already seen it.

### 4.2 CRUD operations

| Op | Path | Sheet interaction |
|---|---|---|
| **Create** | `POST admin` | n8n appends the row; `temp_emp_id` is client-supplied |
| **Read** | Sheet read + `POST onboarding-progress` | Sheets API via BFF (cached); progress via n8n |
| **Update** | `POST onboarding-progress` with `stage` | n8n updates `onboarding_stage` / status cells |
| **Delete** | **Not available** | No delete endpoint exists |

**Delete is a genuine gap.** Removing a mis-provisioned hire today requires manual sheet editing,
which bypasses the audit trail the constitution requires. Recommended options, in order: (a) add a
`POST /webhook/admin` soft-delete that sets `welcome_status = withdrawn` — cheapest and
audit-preserving; (b) a separate `/webhook/admin-revoke`. Hard delete is the worst option: it
destroys the provenance trail. Until one exists, the UI shows no delete affordance rather than
offering a destructive control that cannot work.

**Column typing on read.** The BFF normalizes on ingest: `temp_emp_id` and `cohort` coerced to
integers with blank → `null` (never `0`, which would collide with a real id), `start_date` parsed
from ISO string, malformed rows quarantined rather than rendered. Row 3's garbage (`fafsa`,
`fasfsa`) is filtered at this layer and surfaced to operators, not to employees.

### 4.3 Sync model

Not real-time — polling, at three tiers:

| Layer | Mechanism | Interval |
|---|---|---|
| Employee roster | BFF cache over Sheets API | 60s TTL |
| Visible employee progress | Parallel webhook fan-out, concurrency 6 | 30s, paused when hidden |
| Static reference data | Cached indefinitely | On deploy |

Polling is paused on `document.hidden` and on tab blur, and resumed with an immediate refetch on
return. Every poll shows its freshness in the UI — "updated 12s ago" — so no figure is ever
presented as live when it is not.

Writes do not wait for a poll. After any mutation the affected record is refetched immediately and
the result shown is the authoritative post-write state.

**Concurrency limits:** 6 in-flight webhook requests with a 10s timeout and one automatic retry
with jitter on 5xx only. 4xx and the `status: "error"` body are never retried — they will fail
identically, and retrying just delays the error the user needs to see.

### 4.4 Data-flow honesty

`completed_essentials` and `onboarding_stage` are empty in the sheet while `onboarding-progress`
computes progress independently. The tracker therefore renders from the webhook, and the UI must
not present sheet progress columns as though they were live. Until the workflow persists progress,
there is no single source of truth for progress — a direct conflict with constitution principle V
that needs resolution in either the workflow or the constitution.

---

## 5. Innovation Roadmap

### 5.1 Predictive onboarding analytics

Fit a model on historical cohort completions to forecast each hire's day-14 completion and
probability of stalling on a specific item.

This is genuinely useful, not decorative. In this domain the expensive failure is silent: a hire
stalls on IT provisioning, never says so, and is still producing at 60% capability three weeks in.
Predictive stall detection surfaces that before the human notices.

Surface as a "At risk" column and a dashboard panel. Report it as a probability with the
contributing factors named. A prediction the employee cannot interrogate is not actionable, and a
prediction shown without uncertainty is worse than no prediction.

Blocked on data: the sheet has 3 rows and no completion history. This needs the workflow to persist
`completed_essentials` and per-item completion timestamps. Design now, ship once there is a
history.

### 5.2 Grounded policy assistant

Extend `/policies` into a conversation that answers only from the HR document set, with mandatory
citation per claim and an explicit "not covered by policy" path.

This directly implements constitution principles I and II. The value is that the citation is
mandatory: an uncited answer is a bug, not a degraded state. Users learn to trust answers that
always show their source and to distrust anything that does not.

Build on the existing contract — the response already carries `source`, so provenance is part of the
wire format. Add multi-turn context, retrieve relevant policy sections before answering, and
require that every factual sentence map to a retrieved passage.

Hard constraints carried from the constitution and from §0.3: no generation without retrieval, no
answer without a citation, refusal over guessing, and an explicit `unanswered` state when nothing
covers the question. Retained document versions matter here — a benefits answer must reflect the
policy in force on the person's start date.

### 5.3 Personalized milestone timeline and nudges

Generate a per-person timeline from `start_date`, `role`, `cohort`, and the essentials template,
then nudge on slack when a milestone is at risk.

The calendar problem the brief describes is really a notification problem. A meeting exists in
someone else's calendar and nobody is reminded. A timeline that renders one person's actual
sequence, with proactive nudges, removes the failure directly.

Personalize by role and cohort, since `total_essentials` already varies by employee. Milestones are
canonical records with owners and dates, satisfying principle IV and keeping them out of chat
transcripts.

Guardrail: never nudge about something the recipient cannot act on, and every nudge carries a
one-click path to the underlying record. Notification fatigue is the failure mode — an ignored
notification is worse than none.

---

## 6. Open Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | `admin` required-field set unverified | **Blocking** — form cannot ship | Confirm against workflow; feature-flag the form off until then |
| 2 | No delete path | Manual sheet edits bypass audit trail | Add soft-delete via n8n; hide delete UI meanwhile |
| 3 | Policy empty-answer returns `status: success` | Employees see blank cards | Dedicated `unanswered` state (§0.3) |
| 4 | Progress never persisted to the sheet | Contradicts constitution principle V | Persist in workflow, or amend the constitution |
| 5 | Sheet is link-shared with write implied | Sheet is world-editable via URL | Confirm sharing scope; move to a service-account-only model |
| 6 | Sheet has 3 rows, one is garbage | Dashboards render test data | Filter in the BFF; clean the sheet manually |
| 7 | `temp_emp_id`/`cohort` mixed-typed | Breaks joins, sorting, comparison | Coerce and validate at ingest (§4.2) |
| 8 | `welcome` returns 500 for unknown ids | Weak error surface for HR | Client-side id validation before POST |
| 9 | No policy list or category mode | Hub cannot do categorized browse | Source registry, or add an n8n list mode |
| 10 | Sheet contains live employee PII | Privacy exposure under principle V | Minimize stored PII; audit retention |

---

## 7. Suggested Build Order

1. **BFF foundation** — credential handling, schema validation, authorization, sheet read with
   column normalization, webhook client with retry/timeout.
2. **`/tracker`** — the densest contract and the module that validates the whole data layer.
3. **`/policies`** — search-only, with the full five-state model including `unanswered`.
4. **`/welcome`** — audit view; small surface, validates idempotent-success handling.
5. **`/new-hire`** — blocked on contract confirmation (risk 1).
6. **Dashboard** — composed from tracker data rather than adding new backend work.

Each module ships with all five data states complete. A module with partial states does not meet
the constitution's observability and honesty requirements.

---

## Next Actions

Deferred, not executed:

- Confirm the `admin` payload contract — unblocks `/new-hire`.
- Decide the delete strategy — soft-delete via n8n, or amend the constitution.
- Resolve the progress-persistence conflict — workflow change or constitution amendment.
- Audit the sheet's sharing scope and clean the malformed row.
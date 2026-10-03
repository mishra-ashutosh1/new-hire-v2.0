# Upstream Contracts — n8n Webhooks & Google Sheets

Probed live on 2026-10-02. These are **observed** behaviors, not assumptions. The BFF wraps every
one of these; they are never called directly from the browser.

---

## Transport

All four webhooks are **POST-only**. `GET` returns 404 — this is n8n's default webhook behavior for
an unregistered method, not an outage. The UI must never issue a `GET` and must never surface a
404 as an endpoint failure.

```
POST https://ashtosh.app.n8n.cloud/webhook/admin
POST https://ashtosh.app.n8n.cloud/webhook/onboarding-progress
POST https://ashtosh.app.n8n.cloud/webhook/welcome
POST https://ashtosh.app.n8n.cloud/webhook/policy
Content-Type: application/json
```

---

## /webhook/onboarding-progress — READ

**Request**: `{ "temp_emp_id": string }`. Required; omitting it returns
`{"status":"error","message":"temp_emp_id is required"}`.

Also accepts an optional `stage` for writes — a stage supplied on a read call returns
`requested_stage_update: true`. **There is no list mode.** A tracker of N employees is N calls.

**Observed success response**
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

**Observed not-found response — HTTP 200**
```json
{ "status": "not_found", "message": "No onboarding record found for ...", "temp_emp_id": "..." }
```

### The three-state trap

`success`, `not_found`, and `error` **all arrive as HTTP 200**. Branching on the HTTP code renders
these identically, which misdirects HR to retry a lookup that can never succeed. `not_found` also
means the sheet and the workflow disagree — an ops condition to surface, not a user error (FR-011).

### `total_items` is a constant, not the sheet's count

`total_items: 4` while the sheet's `total_essentials` is `3` for the same employee. **Root cause,
traced into the workflow's `Prepare Onboarding Response` code node (2026-10-02):** the node defines a
hardcoded four-item checklist and reports `total_items: checklist.length`, so the value is always `4`
regardless of the sheet. It never reads `total_essentials`.

The same checklist explains the persistent `completed_count: 0` and `percent_complete: 0`. Completion
is computed as `checklist.filter(item => isDone(input[item.key]))` against these keys:

| Checklist key | Exists in `Sheet1`? |
|---|---|
| `IT_ticket` | **No** |
| `task_complete` | **No** |
| `meet_and_greet_with_team` | **No** |
| `onboarding_status` | **No** — the real column J header is `welcome_status` |

None of the four exist, so every item reads as not-done and all four land in `outstanding`. Progress
is therefore **structurally always `0/4`** and does not reflect the sheet. Both numbers are correct
for their own source: `4` is the workflow's checklist size, `3` is the sheet's `total_essentials`.
Display the webhook's figure and flag the discrepancy; never silently pick one. Reconciling this needs
an n8n change (map the checklist to real sheet columns), not a BFF change.

**RESOLVED 2026-10-03.** The fixed workflow derives `total_items` from `total_essentials` and
`completed_count` from `completed_essentials`, so the two agree at **3** and the discrepancy closes
without a code change in the BFF. See the fixed-workflow section below.

### DESTRUCTIVE WRITE — this workflow blanks `onboarding_stage`

The `Check Onboarding Progress` workflow contains an active `Update Onboarding Stage` googleSheets
node mapped as `onboarding_stage: = {{ $('Onboarding Progress API').first().json.body.onboarding_stage }}`.
On a **read** call that carries no `onboarding_stage` field, the node writes an **empty string** rather
than skipping the row.

Confirmed live: column I held `Not Started` / `In Progress` / `Not Started, In Progress` / `Completed`
early on 2026-10-02 and was empty for all rows within the same session, after probe POSTs carrying only
`temp_emp_id`. Because column H is the formula `=IF(I2="","",COUNTA(SPLIT(I2,",",FALSE,TRUE)))`, `completed_essentials`
goes blank as a direct consequence.

**Operational rule: do not POST to this webhook as a read.** It is not side-effect free. Probe it only
when prepared to restore the sheet from version history, and gate or remove the node first.

> **RESOLVED 2026-10-03 — the workflow is no longer destructive on read.** The `Stage Update Requested?`
> gate described below is live and verified, so the operational rule above no longer applies to reads:
> a call that omits `onboarding_stage` now writes nothing. See "The fix, and its verification" for the
> proof. The column I data destroyed before the fix is still not restored.

### ROOT CAUSE — the gate existed but was wired to nothing

The workflow has always had a `Stage Update Requested?` IF node in front of `Update Onboarding
Stage`. Its condition was:

```json
{ "leftValue": "", "rightValue": "", "operator": { "operation": "equals" } }
```

Both operands were empty strings, and `"" === ""` is **true**, so the gate passed **every** request,
including reads that carry no `onboarding_stage`. The write then stored an empty string. The gate was
present and non-functional, which is why this read as a mystery rather than a missing check.

**Fixed copy:** `C:\Users\ashut\Downloads\Kilo\Check Onboarding Progress - FIXED.json`
(workflow name `Check Onboarding Progress (FIXED 2026-10-03)`). It changes two nodes:

1. `Stage Update Requested?` now tests `={{ $json.body.onboarding_stage }}` with `notEmpty`, so only
   a caller that explicitly supplies a stage can write.
2. `Prepare Onboarding Response` no longer scores against four nonexistent columns. See below.

**To apply:** import the JSON in the n8n UI, activate it, then confirm the **same webhook URL** is
still active (the BFF reads `N8N_BASE_URL`; do not repoint it). Only then set
`TRACKER_PROGRESS_FANOUT=true` and verify column I is unchanged across a tracker request.

**Done, in that order, on 2026-10-03:**

1. Imported and activated, same webhook URL — the response shape changed too, so the
   `total_items` fix below ships in the same workflow.
2. `npm run verify:progress` proved the gate. Because a `'' -> ''` write is invisible, the proof
   seeds a non-empty value first — and it does so **through the workflow's own write path** rather
   than by writing to the sheet, so it needs no Sheets permission beyond the deliberately
   Viewer-only service account. A plain read afterwards left the value intact.
3. `TRACKER_PROGRESS_FANOUT=true`, then a real `GET /api/tracker` over all four roster rows:
   column I byte-identical before and after. The flag is kept as a kill switch.

Also verified live: `total_items` now derives from the sheet's `total_essentials`
(returns `3` against a sheet value of `3`, not the old hardcoded `4`), and
`completed_count` derives from `completed_essentials`.

### `total_items` was a constant, and the checklist columns do not exist

The old `Prepare Onboarding Response` scored progress against four keys:

| Checklist key | Exists in `Sheet1`? |
|---|---|
| `IT_ticket` | **No** |
| `task_complete` | **No** |
| `meet_and_greet_with_team` | **No** |
| `onboarding_status` | **No** — column J is `welcome_status` |

None existed, so every item read as not-done: `completed` was always `[]`, `percent_complete` always
`0`, and `total_items` was the hardcoded `checklist.length` = **4** while the sheet's
`total_essentials` said **3**. Both numbers were correct for their own source — 4 was the workflow's
checklist size, 3 was the sheet's count.

The fixed workflow reports what the sheet actually holds: `total_items` from `total_essentials`,
`completed_count` from `completed_essentials`, and the real `onboarding_stage` chips instead of
invented per-item names. It adds `checklist_source` (`onboarding_stage` | `none`) so the UI can
distinguish "nothing recorded" from "the sheet has no per-item checklist". Reconciling this needs the
n8n change above, not a BFF change.

`Sheet1` has no per-item checklist columns. Until it does, a true per-item outstanding list cannot be
produced by any code — `outstanding` can only echo the chips that are not completion states.

---

## /webhook/policy — READ

**Request**: `{ "question": string }`.

**Parameter probing:** `query`, `search`, `category`, `topic`, `action` all returned **400**. Only
`question` is accepted. **No list or category mode exists.**

**Observed responses — both HTTP 200, both `status: "success"`**
```json
{ "status": "success", "answer": "", "source": "hr_document.md" }
{ "status": "success", "answer": "The policy does not provide enough information to answer this question. Please contact People Operations.", "source": "hr_document.md" }
```

### The empty-answer trap

A successful response can carry an **empty `answer`**. A naive client renders a blank card, or a
loading skeleton that never resolves and reads as "still loading". This is the single most
dangerous shape in the system and is why the BFF contract coerces it to `unanswered` rather than
passing it through (FR-003, SC-003).

The workflow's own refusal phrasing is rendered **verbatim**, not paraphrased, so the employee sees
actual source behavior rather than a UI-rewritten claim.

`source` is a **filename**, not a URL. It cannot be hyperlinked as-is; a filename → canonical URL
registry is required before it becomes a link.

---

## /webhook/welcome — WRITE

**Request**: `{ "temp_emp_id": string }`.

**Observed response**
```json
{ "status": "already_sent", "message": "Welcome email has already been sent for this employee.", "email_sent": false }
```

`already_sent` is **idempotent success**, not an error, and is the expected steady state.
`email_sent: false` means *no new send occurred*, not *the send failed* (FR-017).

Unknown or malformed ids produce **HTTP 500**; the BFF maps this to 502 and echoes the id
(FR-018). Client-side id validation should prevent this path.

---

## /webhook/admin — WRITE (CONTRACT CONFIRMED 2026-10-02)

**Confirmed by live creation.** The required field set was established by exercising a real hire and
observing the sheet result; it is no longer inferred.

**Request**

| Field | Required | Sheet column | Source |
|---|---|---|---|
| `temp_emp_id` | **yes** | `temp_emp_id` | client-supplied, caller-assigned |
| `name` | **yes** | `name` | client |
| `role` | **yes** | `role` | client |
| `emailID` | **yes** | `emailID` | client |
| `start_date` | no | `start_date` | client |
| `cohort` | no | `cohort` | client |
| `total_essentials` | no | `total_essentials` | client |
| `completed_essentials` | no | `completed_essentials` | client |
| `onboarding_stage` | no | `onboarding_stage` | client |

**Response classification** (all HTTP 200 unless noted):

| Body | Meaning | HTTP to caller |
|---|---|---|
| `ok` / `success` | created | 201 |
| `already_processed` | duplicate; **no write performed** | 200 |
| `error` | invalid input | 400 → `PROVISIONING_REJECTED` |

`welcome_sent` is present upstream but **must not be leaked to the caller**.

**Risk, unchanged:** this is the only endpoint that creates a record, with no dry run, and its
workflow has an active "Email welcome message" node. `/new-hire` stays feature-flagged off via
`ADMIN_CONTRACT_VERIFIED` until it is deliberately enabled (SC-007).

---

## Google Sheets

**Sheet ID**: `1FoGZrSYydXmoHnMLfNdqlGa1GOpHdqvwLGOHW8XQz5o`
**Data tab**: `Sheet1` (gid 0). **Pinned range**: `Sheet1!A1:J`
**Value render option**: `FORMATTED_VALUE` — `UNFORMATTED` would return serials for any cell an HR
user later reformats as a true date, silently changing the type underneath the app.

### Columns (verified against the live header row)

`temp_emp_id`, `name`, `role`, `start_date`, `cohort`, `emailID`, `total_essentials`,
`completed_essentials`, `onboarding_stage`, `welcome_status`

Column J is **`welcome_status`**. There is no `onboarding_status` column — that name belongs to the
n8n progress workflow's invented checklist and is the reason it always reports `0/4`.

### Verified data conditions

| Condition | Impact |
|---|---|
| `temp_emp_id` mixed text/number, ≥1 blank | Breaks joins if coerced to number; blank is the one hard reject |
| `cohort` mixed text/number, ≥1 blank | Stored as trimmed string; blank → `null`, never `0` |
| `completed_essentials` is a **formula**, `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))` | Not a stored value. It counts the chips in `onboarding_stage`, so it blanks automatically whenever column I is empty. Never treat it as independent progress data |
| `onboarding_stage` is a **multi-value chips column** | Values can be comma-joined (`"Not Started, In Progress"`). Coarse labels only — `Not Started` / `In Progress` / `Completed` — with **no overlap** with the portal's fine-grained `STAGES` enum |
| `welcome_status` = `welcome_sent` only | Welcome-EMAIL state; a different fact from onboarding progress. Never render it as a stage |
| Test rows present during verification (`1202`, `1301`, `1302`) | Removal deferred: writes paused while column I is recovered from version history |
| `Sheet2` (gid 1) is a byte-identical mirror | **Pin the range** or every employee doubles |

### Stage vocabulary is unconfirmed

The sheet uses coarse labels; `STAGES` in `src/types/domain.ts` is fine-grained
(`not_started`, `it_setup`, `orientation`, `meet_and_greet`, `task_complete`, `status_confirmed`,
`complete`). They share no literal value. A strict enum check rejects everything, which is why tracker
stages rendered blank.

Reconciled **for display only** in `src/lib/stages.ts`: a label map that resolves unambiguous pairs
(`Not Started` → `not_started`, `Completed` → `complete`) and renders anything else verbatim rather
than guessing. `In Progress` is deliberately left unresolved — it spans four of the fine-grained
stages and has no single canonical answer. `STAGES` ordering is unchanged, so the monotonic guard in
`POST /api/tracker/[id]/stage` still behaves exactly as before. The canonical vocabulary remains
**unconfirmed** and owned by the n8n workflow.

### Quotas

300 req/min/project and 60 req/min/user/project for reads and writes; no daily cap. A full read is a
**single request regardless of row count**. 100 employees at a 30s poll = 2 req/min ≈ 0.7% of quota.
No throttling needed; still implement 429 retry.

### Security posture

The sheet is currently **link-shared** — its CSV exports unauthenticated. That is a **PII** problem,
not a credentials problem: names, work emails, cohorts, and start dates are readable by anyone with
the URL, and URL-shared Google docs are forwarded and indexed constantly.

Hardening (~15 min): restrict to the organization; share with the service-account address as
Viewer; add a read timeout and alert on unexpected 4xx; keep the service-account key in n8n
credentials only, never in the client bundle or a committed `.env`.

### ETag support

The Sheets API exposes **no change token, revision, or per-range revision**. It does support HTTP
conditional requests: send the prior `If-None-Match` and an unchanged sheet returns 304. Combine
with a 60s TTL cache.

### Audit sheet

A **separate** spreadsheet, append-only: `timestamp_utc`, `actor_email`, `action`, `emp_id`,
`fields_disclosed`, `request_id`. Never written into the ingest range.

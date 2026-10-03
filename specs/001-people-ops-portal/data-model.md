# Data Model — People Operations Portal

**Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

No application database exists. Every entity below is either projected from the Google Sheet at
ingest time, derived from an n8n response, or written to the audit sheet. Nothing is persisted
application-side except in-process cache.

---

## Ingest pipeline

```
Sheet1!A1:J (Sheets API, service account)
  → raw string cells
  → per-row Zod safeParse ──┬─ valid ──→ Employee[]
                            └─ invalid → QuarantinedRow[]
  → Employee roster (in-process cache, 60s TTL + ETag 304)
```

Ingest never throws on a bad row. One malformed record cannot fail the poll (FR-021).

---

## Employee

The roster entity. Projected from one sheet row; **not** a table we own.

| Field | Source column | Type | Rules |
|---|---|---|---|
| `id` | `temp_emp_id` | `string` | Canonical trimmed key. **Never coerced to number.** Required — blank is the one hard reject, because every lookup keys on it. |
| `name` | `name` | `string` | Trimmed. Required. |
| `role` | `role` | `string` | Trimmed. Optional — absent role renders as an explicit placeholder, not a blank. |
| `startDate` | `start_date` | `string` | ISO `YYYY-MM-DD`, regex + real-calendar check. Read as `FORMATTED_VALUE`, never `UNFORMATTED`. |
| `cohort` | `cohort` | `string \| null` | Mixed type in the sheet. **Stored as trimmed string**, exposed as `null` when blank. Never `0` — that would collide with a real id. |
| `email` | `emailID` | `string` | Email format validated. Secondary fallback key when `id` is missing. |
| `totalEssentials` | `total_essentials` | `number` | Mixed type; preprocessor maps `""` → `undefined`, numeric strings → number. Varies per employee, so it is an attribute and not a global constant. |
| `stage` | `onboarding_stage` | `string \| null` | Coarse sheet label (`Not Started` / `In Progress` / `Completed`), possibly comma-joined from a chips cell. Held values as of 2026-10-02 and was then blanked by the upstream workflow writing an empty string on read. Resolved for display by `src/lib/stages.ts`; it does **not** match the fine-grained `STAGES` enum. |
| `status` | `welcome_status` | `string` | Only observed value is `welcome_sent`. This is welcome-EMAIL state, a different fact from onboarding progress. Free-form until the workflow defines an enum. |

### Identity and fallback

`id` is the join key for every webhook call. A row with a blank `id` is rejected from the primary
roster but retained as `QuarantinedRow` so it remains diagnosable. Where an email is present it is
surfaced as the secondary lookup key, so a blank-id employee is reachable by a human rather than
silently invisible.

### Known data conditions (verified against the live sheet)

- `temp_emp_id` is mixed text/number, and at least one row is blank.
- `cohort` is mixed text/number, with at least one blank.
- `completed_essentials` is a **formula**, `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))` —
  it counts the chips in `onboarding_stage`, so it is derived and never independent data.
- `onboarding_stage` is a **multi-value chips** column. It held `Not Started` / `In Progress` /
  `Not Started, In Progress` / `Completed` on 2026-10-02 and was blanked later that day by the
  `onboarding-progress` workflow writing an empty string on read (see
  `contracts/upstream-integrations.md`). Its labels share no value with the portal's `STAGES` enum.
  The workflow's destructive read was fixed on 2026-10-03 and verified, so nothing will blank the
  column again — but the values it destroyed were **not** restored and the column is still empty for
  every row except the 1302 test row. Restoring it needs sheet version history.
- Three rows are placeholder test data: `1202` Test User Production, and `1301` / `1302` Admin Test
  User. They render in the tracker alongside the one real employee and should be deleted.
- `Sheet2` is a byte-identical mirror of `Sheet1`. Ingest pins `Sheet1!A1:J` so the mirror cannot
  double every employee.

---

## Stage

An ordered enum. Ordering is what makes the monotonic guard possible.

```
not_started → it_setup → orientation → meet_and_greet → task_complete → status_confirmed → complete
```

**Validation rules:**
- Transitions forward only. A write to a stage at or below the current one is rejected or no-op'd.
- This makes double-advance idempotent and makes regression impossible.
- `can_update_stage` from the webhook may forbid the transition regardless of ordering; it wins.

**Note:** the exact stage vocabulary is owned by the n8n workflow, not by this application. The
ordering above reflects the four outstanding items observed live ("IT ticket closed", "Onboarding
task completed", "Meet & greet with team", "Onboarding status confirmed"). Confirm the canonical
enum against the workflow before task decomposition, and treat drift as a mapping concern in the BFF
serializer rather than a domain-model change.

---

## OnboardingProgress (derived, not stored)

Computed per employee by the `onboarding-progress` webhook. Never persisted.

| Field | Type | Notes |
|---|---|---|
| `status` | `"success" \| "not_found" \| "error"` | **Discriminated union, not a loose string.** All three arrive as HTTP 200, so branching on the HTTP code is a defect. |
| `employeeId` | `string` | Echoed from the request. |
| `name` / `role` | `string` | Echoed by the workflow; may differ from the sheet. Sheet wins for display, webhook wins for workflow state. |
| `stage` | `Stage \| null` | Authoritative. Supersedes the empty sheet column. |
| `stageStatus` | `string` | E.g. `welcome_sent`. |
| `percentComplete` | `number` | 0–100, from the workflow. |
| `completedCount` / `totalItems` | `number` | Observed `total_items: 4` against `total_essentials: 3` for employee 1201 — the two disagree. Display the webhook's number and flag the discrepancy rather than silently choosing. |
| `completed` | `string[]` | Item names. |
| `outstanding` | `string[]` | Item names. |
| `canUpdateStage` | `boolean` | Gates the update control. |
| `requestedStageUpdate` | `boolean` | Whether a stage write was part of this call. |

**Relationship:** one Employee → 0 or 1 OnboardingProgress. `status: "not_found"` means the
roster and the workflow disagree — an ops condition surfaced to HR (FR-011), not an empty state.

---

## PolicyDocument and PolicyAnswer (derived, not stored)

| Field | Type | Notes |
|---|---|---|
| `status` | `"success" \| "error"` | |
| `answer` | `string` | **May be empty on a successful response.** Empty answer is a distinct state, never a blank panel (FR-003, SC-003). |
| `source` | `string` | A filename (e.g. `hr_document.md`), not a URL. Cannot be hyperlinked as-is; needs a filename → canonical URL registry to become a link. |

**Answer classification** — the pipeline is:

```
status=success && answer.trim()===""  → UNANSWERED  (no policy covers this)
status=success && answer matches
  "does not provide enough information" → UNANSWERED  (workflow's own refusal, rendered verbatim)
status=success && answer non-empty     → ANSWERED    (must display source)
```

The workflow's own refusal phrasing is rendered verbatim rather than paraphrased, so the employee
sees actual source behavior rather than a UI-rewritten claim.

**No list or category mode exists.** Probes for `query`, `search`, `category`, `topic`, and
`action` all returned 400; only `question` is accepted. Categorized browsing is therefore out of
scope until a list mode is added or a source registry is built.

---

## WelcomeRecord (derived, not stored)

| Field | Type | Notes |
|---|---|---|
| `status` | `"sent" \| "already_sent" \| "error"` | |
| `emailSent` | `boolean` | `false` when `already_sent` — meaning *no new send occurred*, not *the send failed*. |
| `message` | `string` | Rendered as the primary confirmation text. |

`already_sent` is idempotent success, not an error (FR-017). It is the expected steady state.

---

## User and Role

| Role | Modules | Employee scope |
|---|---|---|
| `hr_admin` | Dashboard, tracker, welcome, policies, new hire | All |
| `manager` | Dashboard, tracker, policies | Direct reports |
| `new_hire` | Own tracker, policies | Own record only |

Enforced server-side before any employee data is fetched (FR-023). Hiding nav items is presentation,
not access control.

Authentication uses the organization's existing identity provider via a signed session cookie
carrying a role claim. RBAC is a switch, not a policy engine.

---

## QuarantinedRow

| Field | Type | Notes |
|---|---|---|
| `rowNumber` | `number` | 1-indexed, matching the sheet, so HR can find it. |
| `raw` | `Record<string, string>` | Original cells. |
| `issues` | `string[]` | Zod issue paths and messages. |

Surfaced as an operator count ("3 rows quarantined"), never to employees. The application never
deletes or repairs sheet rows — HR owns that data.

---

## AuditEvent (written to a separate sheet)

| Field | Type | Notes |
|---|---|---|
| `timestampUtc` | ISO string | |
| `actorEmail` | string | From the session, never client-supplied. |
| `action` | `view \| list \| advance_stage \| export \| create` | |
| `employeeId` | `string` | Affected employee, or `*` for list operations. |
| `fieldsDisclosed` | `string[]` | Which fields were actually returned. |
| `requestId` | string | Correlation id. |

Written **before** employee data is returned. If the audit write fails, the read fails — unlogged
PII is never served. Never written into the ingest range.

---

## PII exclusions

Never read into the model, never cached, never returned: compensation, health information, benefits
elections, government identifiers (FR-024). The sheet does not currently hold these columns, but the
serializer must enforce the exclusion by allowlist rather than by denylist, so that a future column
cannot silently leak into a response.

---

## Entity relationships

```
Employee 1 ── 0..1 OnboardingProgress   (derived per request, never stored)
Employee 1 ── 0..1 WelcomeRecord        (derived per request, never stored)
PolicyDocument 1 ── 0..n PolicyAnswer   (derived per request, never stored)
User n ── 1 Role                        (session claim)
Employee * ── 0..1 QuarantinedRow       (invalid rows, reported not rendered)
Every disclosure ── 1 AuditEvent         (written before the read completes)
```

**Storage summary:** zero application-owned tables. Two Google Sheets are read or written (data +
audit), one n8n workflow set is called, and the only application state is an in-process cache.

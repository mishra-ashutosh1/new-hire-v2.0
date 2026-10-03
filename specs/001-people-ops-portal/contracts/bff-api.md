# BFF API Contract — People Operations Portal

The BFF is the only surface the browser talks to. It holds n8n and Sheets credentials, enforces
authorization before fetching employee data, normalizes mixed-typed sheet columns, and records an
audit event before returning anything sensitive.

**Base path**: `/api`
**Auth**: signed session cookie with a `role` claim. All routes require a session.
**Error envelope**: `{ "error": { "code": string, "message": string, "details"?: unknown } }`

---

## GET /api/tracker

The fan-out aggregator. Reads the cached roster, issues `onboarding-progress` per employee at
concurrency 6, and returns a discriminated union per row.

**Why it exists:** `onboarding-progress` requires a `temp_emp_id` and has no list mode, so a tracker
of N employees is N upstream calls. This collapses them into one browser request, and makes partial
failure a *value* in the response instead of an exception.

### Response

```ts
type RowResult =
  | { id: string; state: "success"; data: OnboardingProgress }
  | { id: string; state: "not_found"; message: string }
  | { id: string; state: "error"; message: string };

type TrackerResponse = {
  rows: RowResult[];
  rosterFreshness: { fetchedAt: string; ageSeconds: number; source: "live" | "cache" | "stale" };
  quarantined: { count: number; rowNumbers: number[] };
  generatedAt: string;
};
```

**Contract notes:**
- The three `state` values are exhaustive. There is no fourth case, so a caller cannot silently
  collapse `not_found` into `error` — the compiler rejects it.
- `rows` is built with `Promise.allSettled`. A single failing employee MUST NOT remove other rows.
- `rosterFreshness` is always present so the UI can display data age (FR-020).
- `quarantined` reports malformed rows to operators only; the array itself is not returned.

### Errors

| Status | When |
|---|---|
| 401 | No session |
| 403 | Role cannot view tracker |
| 502 | Roster read failed and no cache is available |

A single employee's upstream failure is **not** a 502 — it is a `{ state: "error" }` row.

---

## GET /api/tracker/[id]

Single-employee hydration for the detail view.

**Response**: `{ "employee": Employee, "progress": RowResult, "freshness": {...} }`

**Errors**: 401, 403, 404 (no such employee in roster), 502 (upstream and cache both unavailable).

---

## POST /api/tracker/[id]/stage

Advances onboarding stage.

**Request**
```ts
{ "stage": "it_setup" | "orientation" | "meet_and_greet" | "task_complete" | "status_confirmed" | "complete" }
```

**Response**: the **authoritative post-update** progress payload, refetched after the write (FR-010).
Never an optimistically-constructed value.

**Errors**
| Status | When |
|---|---|
| 400 | Unknown stage value |
| 403 | Role cannot advance, or `can_update_stage` is false |
| 409 | Monotonic guard rejected a backwards or duplicate transition |
| 502 | Upstream write or refetch failed |

**Audit**: `advance_stage` event written before the response.

---

## GET /api/policies/search?q=<question>

Search-only. Probes confirmed that `category`, `topic`, `query`, `search`, and `action` all return
400; the upstream workflow accepts `question` only.

**Response**
```ts
type PolicyResponse = {
  status: "answered" | "unanswered" | "error";
  answer: string | null;
  source: string | null;
};
```

**Contract notes:**
- `status: "answered"` REQUIRES a non-empty `answer` AND a non-empty `source`. The BFF enforces
  this invariant; a violating upstream payload is coerced to `unanswered`, never passed through
  (FR-002, SC-002).
- `status: "unanswered"` covers both an empty `answer` on a successful response and the workflow's
  own "does not provide enough information" refusal.
- The BFF must never return `{ status: "success", answer: "" }` — that shape is the defect this
  endpoint exists to prevent.

**Errors**: 401, 403, 429 (rate limited), 502 (upstream unreachable).

---

## GET /api/welcome

Welcome status audit list, sourced from the sheet roster. The upstream endpoint is per-employee
only, so statuses are hydrated per row on demand via `POST /api/welcome/[id]`.

**Response**: `{ "rows": Array<{ employee: Employee; status: string | null }>, freshness: {...} }`

---

## POST /api/welcome/[id]

**Response**
```ts
type WelcomeResponse =
  | { status: "sent"; emailSent: true; message: string }
  | { status: "already_sent"; emailSent: false; message: string };
```

**Contract notes:**
- `already_sent` returns HTTP 200. It is idempotent success, not an error (FR-017).
- `emailSent: false` on `already_sent` means *no new send occurred*, not *the send failed*. The UI
  must not render this as a warning.
- The upstream returns 500 for unknown or malformed ids; the BFF maps that to 502 with the id
  echoed (FR-018).

**Audit**: `view` or `create` event written before the response.

---

## POST /api/admin/new-hire

**CONTRACT CONFIRMED 2026-10-02** — verified by exercising a real hire and by reading the
`Validate New Hire1` node source. The previous "provisional / inferred" marking is removed.

**Request** (`adminRequestSchema`, confirmed)
```ts
{
  tempEmpId: string,              // REQUIRED — wire name temp_emp_id
  name: string,
  role: string,
  email: string,
  startDate?: string | null,      // optional
  cohort?: string | null,         // optional
  totalEssentials?: number | null,      // optional, client-supplied
  completedEssentials?: number | null, // optional
  onboardingStage?: string | null       // optional; workflow defaults to 'Day 0'
}
```

**Contract notes:**
- `tempEmpId` **is required and caller-assigned.** The workflow errors with
  `temp_emp_id is required` when it is absent. An earlier version of this schema rejected it on the
  belief that it was workflow-generated, which would have 400'd every real provisioning call.
- `totalEssentials` is **not** workflow-generated; the node copies it from the request when present.
  `startDate` is **not** required — the node copies it through when present.
- The BFF speaks camelCase; the route maps to the snake_case wire names. The snake_case
  `temp_emp_id` key is rejected at the BFF boundary so one field has exactly one spelling.
- The schema stays `.strict()`: an unrecognised key is an error, so a typo surfaces as a 400 rather
  than being silently dropped upstream.
- **Still feature-flagged off** via `ADMIN_CONTRACT_VERIFIED`. Confirming the contract is not the
  same as enabling the endpoint: this has no dry run and its workflow sends a real welcome email.
  Returns 503 `{ code: "CONTRACT_UNVERIFIED" }` while disabled.
- Double submission MUST be prevented: an in-flight mutex keyed by a client-generated request id,
  so one submission cannot create two records (FR-014, SC-007).
- `welcome_sent` from the upstream response is never leaked to the caller.

**Response**: `{ "id": string, "message": string }` — the created identifier (FR-015).

**Errors**: 400 (field-level details), 409 (duplicate submission), 503 (flagged off), 502.

---

## GET /api/health

Liveness for both upstreams. Used by the dashboard system-health panel.

**Response**
```ts
{
  "status": "ok" | "degraded",
  "n8n": { "reachable": boolean, "checkedAt": string },
  "sheet": { "reachable": boolean, "ageSeconds": number, "checkedAt": string }
}
```

---

## Cross-cutting rules

1. **Authorization precedes fetch.** Role and employee scope are checked before any employee data is
   requested upstream. Not enforced by filtering response text.
2. **Audit precedes disclosure.** The audit row is written before employee data is returned. A
   failed audit write fails the read.
3. **PII allowlist.** The serializer emits fields from an explicit allowlist, never a denylist, so a
   future sheet column cannot leak by default.
4. **No credentials to the client.** n8n URLs and Sheets credentials are server-side only, enforced
   by the `NEXT_PUBLIC_` compile-time boundary.
5. **Retry policy.** One retry with jitter on 5xx and 429 only. Never retry 4xx or a body-level
   `status: "error"` (FR-022).
6. **Freshness is always reported.** Every response carrying employee data includes its age.

# Deploying the onboarding webhook (Apps Script + n8n)

Companion to `scripts/apps-script/onboarding-webhook.gs`.

## Your sheet, as the script sees it

Columns are resolved **by header name**, never by index — so order does not matter
and a future column will not shift anything.

| # | Column | Owner | Written by this script? |
|---|---|---|---|
| A | `temp_emp_id` | you | **Never.** It is the lookup key. |
| B | `name` | you | Yes |
| C | `role` | you | Yes |
| D | `start_date` | you | Yes |
| E | `cohort` | you | Yes |
| F | `emailID` | you | Yes |
| G | `total_essentials` | you | Yes |
| H | `completed_essentials` | you | **Never.** Read-only here. |
| I | `onboarding_stage` | you | **Yes** — validated against the 3-value allowlist |
| J | `welcome_status` | you | **Never.** Read-only here. |
| K | `onboarding_progress_status` | **you — optional; `setUp()` will NOT create it** | Yes, derived from `onboarding_stage`, only if the column exists |
| L | `last_synced_at` | **you — optional; `setUp()` will NOT create it** | Yes, freshness timestamp, only if the column exists |

> `setUp()` is a **read-only audit**. It performs no writes at all — it does not
> create, rename, reorder, reformat or backfill anything. Columns K and L are
> reported as `PRESENT`/`ABSENT` and are entirely optional: the portal derives
> progress status from `onboarding_stage` at display time. Add them by hand if
> you want the values persisted.

## Current live deployment

Recorded 2026-10-02. This is the only endpoint n8n should call.

| Item | Value |
|---|---|
| Apps Script ID | `1E-xQ67NPSJdmfMoMkbsmzYYS4tPfq6C3q5ZdboIXDTDgXAjrFcv1SoAk` |
| Live deployment ID | `AKfycbxDRayH4bMlPiJoj1xj_8s35b3mdajQvQ6OEbIPJAkRjA354N_mcqswK03IJQUCGtCp` |
| `/exec` URL | `https://script.google.com/macros/s/AKfycbxDRayH4bMlPiJoj1xj_8s35b3mdajQvQ6OEbIPJAkRjA354N_mcqswK03IJQUCGtCp/exec` |
| Pinned version | 5 |
| Execute as | Me |
| Access | Anyone |

**Do not deploy from a stale editor tab.** The Apps Script IDE keeps unsaved
content and will silently overwrite anything pushed via `clasp`. Close the tab
and reopen before deploying, and never type or `Ctrl+S` first. This happened
twice during setup and silently reverted the deployed code to the placeholder.

### Ignore list — deployments that must NOT be used

Verified 2026-10-02. If you see these in **Deploy → Manage deployments**, ignore
them. Only `AKfycbxDRayH4…` is live.

| Deployment ID | Version | What it is | Why ignore |
|---|---|---|---|
| `AKfycbzAmo_pqAoUGzEVSNo1NE8BQMVqT2pWkgGMx0zLfnc` | `@HEAD` | Original `@HEAD` deployment, still serving the `myFunction()` placeholder behind a Google sign-in wall | Has no `doGet`/`doPost`. Returns a ~940 KB login page, not JSON. It looks like the oldest, most legitimate URL in the list — that is exactly the trap. |
| *(already deleted)* `AKfycbwhFIoJ…` | 1 | First `clasp` deployment attempt | Removed |
| *(already deleted)* `AKfycbyNOw8…` | 2 | Second attempt, sign-in-walled | Removed |

`AKfycbzAmo…` is an `@HEAD` deployment, which Google makes immutable — the API
refuses both modification and deletion
(`Read-only deployments may not be modified` / `...may not be deleted`).

To remove it manually: **Deploy → Manage deployments →** find the row → open its
**⋮ (three-dot) menu → Delete**. It is *not* under the ✏️ edit dialog, which is
why it can look like there is no delete option.

If the ⋮ menu offers no Delete, leave it. It is harmless while unused — it cannot
write to your sheet, cannot be reached by n8n without a Google sign-in, and does
not affect the live deployment. The ignore list above is sufficient protection.

## Runtime behaviour n8n must respect

**Apps Script web apps cannot set an HTTP status code.** `ContentService.TextOutput`
exposes only `setContentType`, `setMimeType` and `getAs`, so **every** response
arrives as **HTTP 200** — including auth failures and validation errors. The
intended status is carried in the body as `http_status`.

Branch on the body's `status` field, never on the HTTP code:

| Response | Meaning | Retry? |
|---|---|---|
| `200` + `status:"success"` | row updated; see `fields_written` | no |
| `200` + `status:"not_found"` | no row matches that `temp_emp_id` | no |
| `200` + `status:"error"` + `http_status` | see `code` for the reason | depends on `code` |
| **`404`** | **throttle or propagation — never reached the script** | **yes, back off** |
| `401`/`403` from Google | deployment access is not `Anyone` | no — fix access |

A Google-generated `404` is **not** a missing employee. Treating it as one makes
n8n silently drop updates; treating a real `not_found` as a throttle makes it
retry forever.

**Rapid requests get throttled.** Burst calls to the deployment return `404`.
Verified: 6/8 failed at 4-second intervals, 6/6 passed at 20-second intervals.
Space n8n calls out, and retry `404` with backoff.

`welcome_status` and `onboarding_progress_status` are deliberately **separate
columns**. They answer different questions and are written by different things:

- `welcome_status` — welcome-**email** state (`welcome_sent`), owned by you/your automation.
- `onboarding_progress_status` — onboarding-**progress** state (`100% onboarding
  completed`), owned by this webhook, derived from `onboarding_stage`.

Merging them would mean the first webhook overwrites your welcome audit trail.

## What `setUp()` does — and does not do

**Creates exactly two header cells at the far right**, and only if absent:

1. `onboarding_progress_status`
2. `last_synced_at`

That is its only write.

**It does NOT:**

- modify any existing row — no backfill, no clearing, no touching row 2+
- rename, reorder or reformat any existing column
- touch `welcome_status`, `temp_emp_id`, or `completed_essentials`
- convert `onboarding_stage` to Chips — no Apps Script API exists for that
- apply data validation — it would silently convert Chips back to plain text

It is idempotent: running it twice changes nothing the second time.

It **reports**, read-only: your current column inventory, whether `temp_emp_id`
was found, whether any duplicate ids exist, and whether `onboarding_stage` is
actually a Chips column.

## Response contract

Every row below arrives as **HTTP 200**. The "intended" column is the value
carried in the body's `http_status` field — it is documentation of severity, not
a code Google sends.

| Situation | HTTP | `status` | `code` | `http_status` |
|---|---|---|---|---|
| Row updated | 200 | `success` | — | absent |
| Updated, values already matched (`changed:false`) | 200 | `success` | — | absent |
| Derived column missing | 200 | `success` | — (plus `warnings[]`) | absent |
| No row with that `temp_emp_id` | 200 | `not_found` | `NO_SUCH_EMPLOYEE` | 404 |
| Missing `temp_emp_id`, unknown field, bad stage/email/number | 200 | `error` | `VALIDATION_FAILED` | 400 |
| Write aimed at a read-only column | 200 | `error` | `VALIDATION_FAILED` | 400 |
| Body is not a JSON object | 200 | `error` | `MALFORMED_BODY` | 400 |
| Bad or missing token | 200 | `error` | `UNAUTHENTICATED` | 401 |
| Stage would move backwards | 200 | `error` | `NON_MONOTONIC_STAGE` | 409 |
| Duplicate `temp_emp_id` | 200 | `error` | `INTERNAL` | 500 |
| Secret not configured | 200 | `error` | `NOT_CONFIGURED` | 503 |

`status: "not_found"` on a missing row is deliberate — a hire not yet onboarded is
not a failure, and returning an `error` would make n8n retry forever.

If `onboarding_progress_status` is absent the write still **succeeds** and the
response carries a `warnings[]` entry. That is intentional: refusing to record
progress because a derived column is missing would be worse than recording the
stage and reporting the gap.

## 1 — Create the script

Open the spreadsheet → **Extensions → Apps Script**. Delete the contents of
`Code.gs` and paste the whole `onboarding-webhook.gs` file in, replacing the stub
`myFunction`/`setUp` entirely.

Binding the script to the sheet is what lets it resolve the spreadsheet without
hardcoding the sheet ID.

## 2 — Run `setUp()` once

Select `setUp` in the function dropdown → **Run** → approve the permission prompt.

Read the **Execution log**. You are looking for:

- `CREATED: onboarding_progress_status, last_synced_at`
- `EXISTING ROWS modified: NONE`
- `DUPLICATE CHECK: OK`
- `CHIPS CHECK: …`

**If `DUPLICATE CHECK: FAIL`** — do not continue. Two rows sharing a
`temp_emp_id` make the webhook refuse to write at all, which is deliberate: picking
one arbitrarily is how a hire gets lost.

Your sheet currently holds one test record (`Test User Production`,
`test@example.com`) and one real one. Delete the test row before go-live.

## 3 — Convert `onboarding_stage` to Chips (manual)

Apps Script has **no Chips API** — no create, no validate. Select the
`onboarding_stage` column header → **Insert → Chips**.

Until you do, the column is plain text. That is safe: the webhook validates every
write against the allowlist itself and rejects anything else (`VALIDATION_FAILED`). You just
won't have the multi-select UI.

## 4 — Set the shared secret

**Project Settings → Script Properties → Add script property**

| Property | Value |
|---|---|
| `WEBHOOK_SECRET` | 32+ random characters — e.g. `openssl rand -hex 24` |
| `ALLOW_BACKWARD_TRANSITIONS` | omit entirely (defaults to false) |

Use Script Properties, never a literal in the source. The script **fails closed**
with `status:"error"`, `code:"NOT_CONFIGURED"` (`http_status` 503) when this is missing — deliberate, because an unset
secret must not mean an open endpoint on a PII sheet.

## 5 — Deploy as a web app

**Deploy → New deployment → ⚙ → Web app**

| Field | Value | Why |
|---|---|---|
| Execute as | **Me** | needs sheet write access |
| Access | **Anyone** | n8n Cloud is external, has no Google identity |

Copy the **`/exec`** URL.

- `/exec`, never `/dev` — `/dev` runs with a live editor and is not deployable.
- **Re-deploy after every change.** Edits do not take effect until you create a
  new deployment version (Deploy → Manage deployments → ✏️ → Version: New version).

### Security note on "Anyone"

This deployment is anonymously reachable by anyone holding the URL, and it writes
a sheet containing real names, work emails, and start dates. The `token` is the
**only** control. Treat the URL as a credential: generate a long random secret,
never reuse it elsewhere, never paste it into Slack/tickets/git, and rotate by
changing the Script Property and re-deploying.

If you can move n8n behind a Google Workspace identity, switch Access to *Anyone
with Google account* and drop the token entirely.

## 6 — Verify before wiring n8n

```bash
curl "https://script.google.com/macros/s/YOUR_ID/exec?token=YOUR_TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"temp_emp_id":"1201","onboarding_stage":"Completed"}'
```

Expect:
```json
{"status":"success","temp_emp_id":"1201","row":2,"changed":true,
 "fields_written":{"onboarding_stage":"Completed",
                   "onboarding_progress_status":"100% onboarding completed",
                   "last_synced_at":"2026-10-02T..."},
 "warnings":[]}
```

Then check the failure paths — those are the ones that matter. Each returns
**HTTP 200**, so inspect the body's `status` and `http_status`:

```bash
# 401 UNAUTHENTICATED — wrong token
curl ".../exec?token=WRONG" -X POST -d '{"temp_emp_id":"1201","onboarding_stage":"Completed"}'

# 400 VALIDATION_FAILED — stage outside the allowlist
curl ".../exec?token=OK" -X POST -d '{"temp_emp_id":"1201","onboarding_stage":"Pending"}'

# 400 VALIDATION_FAILED — welcome_status is read-only here
curl ".../exec?token=OK" -X POST -d '{"temp_emp_id":"1201","welcome_status":"welcome_sent"}'

# 409 NON_MONOTONIC_STAGE — backward transition (move forward first, then back)
curl ".../exec?token=OK" -X POST -d '{"temp_emp_id":"1201","onboarding_stage":"Not Started"}'

# 404 NO_SUCH_EMPLOYEE — unknown id: a normal outcome, not a failure
curl ".../exec?token=OK" -X POST -d '{"temp_emp_id":"does-not-exist"}'
```

## 7 — Wire the n8n HTTP Request node

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | see `ONBOARDING_WEBHOOK_URL` in `.env.example`, plus `?token=…` |
| Send Body | on |
| Body Content Type | JSON |
| Authentication | **None** |
| Retry on Fail | **on**, for HTTP 404 only |

**Body**
```json
{
  "temp_emp_id": "{{ $json.temp_emp_id }}",
  "onboarding_stage": "{{ $json.onboarding_stage }}"
}
```

**Do not set an n8n `Authorization` header.** Apps Script cannot read custom
request headers at all — the event object exposes only `postData`, `parameter`,
and `contentLength`. The token in the query string is the only option.

Handle responses on the **body**, never the HTTP code:

- `status:"success"` → done, no retry.
- `status:"not_found"` → terminal, **no retry**. The hire is not onboarded yet.
- `status:"error"` with `code:"UNAUTHENTICATED"` / `NOT_CONFIGURED` → **no retry**,
  the deployment is misconfigured; alert a human.
- `status:"error"` with `code:"INTERNAL"` → retryable.
- **HTTP 404 with no JSON body** → throttled or not yet propagated. **Retry with
  backoff.** This is the one case where the HTTP code carries meaning.

Idempotent: a repeated write produces `"changed": false` and identical state, so
n8n retries are safe.

## Payload the script accepts

```json
{
  "temp_emp_id": "1201",
  "onboarding_stage": "In Progress",
  "name": "Ashish Kumar",
  "role": "Developer - Lead",
  "start_date": "2026-09-30",
  "cohort": "3",
  "emailID": "ashish.kumar@company.com",
  "total_essentials": 3
}
```

Only `temp_emp_id` plus at least one writable field are required.

- **Key aliases:** `tempEmpId`, `emp_id`, `id`.
- **`onboarding_stage`** accepts either vocabulary — the three sheet values
  (`"Not Started"`, `"In Progress"`, `"Completed"`) or the app's seven fine stages
  (`it_setup`, `complete`, …), case- and separator-insensitively.
- **`temp_emp_id` is never coerced to a number.** The sheet stores it as both text
  and number, and a long id or a leading zero would lose digits.
- **Blank optional fields mean *leave alone*, never *clear*.** An omitted
  `emailID` must not blank a real address already in the sheet.
- **`welcome_status`, `completed_essentials`, `onboarding_progress_status`,
  `last_synced_at` are refused (`VALIDATION_FAILED`)** if supplied. The derived two are
  written by the script from the stage; `welcome_status` is yours.
- The whole payload is rejected on the first invalid field — no partial writes.

## Behaviour worth knowing

**Sheets is not a database.** This is `setValue` per cell with a key-column scan.
Correct and safe at HR scale (low write volume, hundreds of rows); it will not
scale to tens of thousands of writes.

**The lock is per script execution.** Concurrent webhooks for the *same row* are
serialised. Concurrent *workflows* firing at once can still interleave — that needs
a queue, not a bigger timeout.

**Stage transitions are monotonic by default.** `In Progress → Not Started` returns
`NON_MONOTONIC_STAGE` (`http_status` 409). Set `ALLOW_BACKWARD_TRANSITIONS=true` as a Script Property if you need
corrections, but leave it off: it is the only thing stopping a misfired webhook
from un-completing a hire.

## Verifying locally

Apps Script cannot run under Node, so `tests/unit/apps-script.test.ts` loads the
**actual `.gs` source** with the Google globals stubbed and exercises the pure
logic — the 7→3 stage mapping, the conservative reverse map, payload validation,
the writable/read-only column lists, header resolution, and token comparison.

```
npx vitest run tests/unit/apps-script.test.ts
```

It reads the shipped file rather than a copy, so the verified logic cannot drift
away from the deployed script. It has already caught two real defects that would
have shipped broken: a `CONFIG` self-reference inside its own object literal that
left the read-only list full of `undefined`, and `onboarding_stage` appearing in
both the writable and read-only lists.
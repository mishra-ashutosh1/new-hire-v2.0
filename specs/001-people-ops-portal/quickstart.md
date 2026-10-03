# Quickstart — Validation Guide

**Date**: 2026-10-02 | **Plan**: [plan.md](./plan.md)

Runnable scenarios that prove the feature works end to end. Implementation detail lives in
`tasks.md`; this is a validation guide only.

---

## Prerequisites

- Node.js 22 LTS
- Docker (for local Postgres-free stack — only a Node container is needed)
- Access to the n8n instance and the Google Sheet
- Service-account credentials in the environment (never in the client bundle):
  ```
  N8N_BASE_URL=https://ashtosh.app.n8n.cloud
  SHEET_ID=1FoGZrSYydXmoHnMLfNdqlGa1GOpHdqvwLGOHW8XQz5o
  GOOGLE_SERVICE_ACCOUNT_JSON=<base64 or file path>
  AUDIT_SHEET_ID=<separate audit sheet>
  SESSION_SECRET=<32+ bytes>
  ADMIN_CONTRACT_VERIFIED=false
  ```

---

## Setup

```bash
npm install
cp .env.example .env.local   # fill values above
npm run dev                  # http://localhost:3000
```

Verify the environment before touching UI work:

```bash
npm run check:upstreams
```

Expected: `n8n: reachable`, `sheet: reachable`. This probes `/api/health`, which exercises a real
webhook and a real sheet read. If either fails, stop and fix credentials — every other validation
below depends on them.

`check:upstreams` will also report a **FAIL** until sign-in is configured. That is deliberate: without
an OAuth client, every API returns 401 and the portal serves nobody. See below.

### Signing in

There are two ways to get a session, and they are not interchangeable.

**Locally — `npm run dev:session`.** Mints a `portal_session` cookie signed with the same
`SESSION_SECRET` the app verifies, and writes it to `scripts/.dev-session.json`. Use it with the dev
cookie; never wire it into the app.

**Anywhere else — a passcode.** `npm run auth:passcode` prints a passcode **once** plus
its scrypt hash. Put the **hash** in `HR_ADMIN_PASSCODE_HASH` (never the passcode — a
leaked config file would then hand over a login), restart, and use the form on `/login`.

Google OAuth is better where you can get it, because it authenticates a *person*. It needs
a Google Cloud project, which in a Workspace domain means **asking an admin** to register the
OAuth client — an individual operator gets a permission error.

**A passcode grants a role, not a person.** Sessions carry `passcode:<role>` with no `selfId`,
so a passcode cannot open an individual employee's own record. Per-employee self-service
requires Google OAuth.

**Google sign-in.** `/login` → "Sign in with Google".

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Web application**.
2. **Authorized redirect URIs**: add `http://localhost:3000/api/auth/google/callback` for local, and
   `https://<your-host>/api/auth/google/callback` for a deployment. It must match
   `GOOGLE_OAUTH_REDIRECT_URI` **exactly**, including scheme, port and trailing slash.
3. In `.env.local`:

   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   HR_ADMIN_EMAILS=your.address@company.com
   MANAGER_EMAILS=               # optional
   ```

Then visit `/login` and sign in.

**With Google sign-in, roles come from the allowlist, not the account.** A verified login proves
*who* you are, never *what you may see* — otherwise anyone who could create a Google account
would inherit HR admin. Resolution order:

| Address is… | Gets |
|---|---|
| in `HR_ADMIN_EMAILS` | `hr_admin` — the whole roster |
| in `MANAGER_EMAILS` | `manager` — scoped to their own reporting line |
| in the roster (by `emailID`) | `new_hire` — **their own row only** |
| none of the above | **refused**, with an explanation |

Adding yourself to `HR_ADMIN_EMAILS` is the step people miss. Sign-in will otherwise succeed and then
show you nothing, because a `new_hire` sees only their own employee record.

**Passcodes are rate limited** to 5 attempts per 15 minutes per address. Note the limiter is
in-process: it works on a single instance, and needs a shared store behind a load balancer.

---

## Scenario 1 — Upstream contracts still hold

The contracts in `contracts/upstream-integrations.md` were probed on 2026-10-02. They drift. Re-verify
before trusting any downstream behavior.

```bash
npm run probe:upstreams
```

> ✅ **All 8 probes run, none skipped, as of 2026-10-03.** They used to be gated behind
> `PROBE_ALLOW_SHEET_WRITES` because `onboarding-progress` was **destructive**: it held a
> googleSheets node that wrote an empty string to the sheet's `onboarding_stage` column on any
> read that omitted that field, so rows 3, 4 and 5 below — which send only a `temp_emp_id` — used
> to erase that employee's stage data, and `completed_essentials` with it, being a formula over
> that column. That node is now gated behind `requested_stage_update`, so a read writes nothing.
> Proof, not assumption: `npm run verify:progress` seeds a value through the workflow's own write
> path and confirms a plain read leaves it intact. `PROBE_ALLOW_SHEET_WRITES` is still read but
> only to warn that it no longer has any effect.
>
> Only the `welcome` probe can still skip — and that one is conditional for a real reason: unless
> `welcome_status` is exactly `welcome_sent`, calling it **sends an actual email**. It reads the
> column first and only calls the webhook when the call provably cannot send.

**Expected output**

| Probe | Expect |
|---|---|
| `GET /admin` | 404 (POST-only, not an outage) |
| `POST /admin` `{}` | 400 |
| `POST /onboarding-progress` `{}` | 200, `status: "error"`, `temp_emp_id is required` — **SKIPPED unless `PROBE_ALLOW_SHEET_WRITES=true`** |
| `POST /onboarding-progress` known id | 200, `status: "success"` — **SKIPPED unless opted in** |
| `POST /onboarding-progress` fake id | 200, `status: "not_found"` — **SKIPPED unless opted in** |
| `POST /policy` `{question}` | 200, `status: "success"` |
| `POST /welcome` known id | 200, `already_sent` — **only run when `welcome_status` is already `welcome_sent`** |

> ⚠️ **The `welcome` probe is conditional, and it can send a real email.** The workflow's
> `Welcome Already Sent?` node tests `welcome_status === "welcome_sent"` exactly. On a match it
> short-circuits with no email and no write; on anything else it sends email and updates the sheet.
> The probe therefore reads `welcome_status` from the sheet first and only calls the webhook when
> the call provably cannot send — otherwise it reports SKIP with the reason. Pointing
> `PROBE_EMP_ID` at a hire who has not been emailed is safe because the probe declines to call it.
| `POST /welcome` known id | 200, `status: "already_sent"` |

**Failure signal**: any probe returning something else. The three-state trap and the empty-answer
trap are the two behaviors most likely to change silently — if either flips, update the BFF contract
before touching the UI.

---

## Scenario 2 — Ingest survives malformed data

The live sheet contains a garbage row. Ingest must not fail because of it.

```bash
npm run seed:fixtures   # writes known-bad rows to a test sheet, NOT the live sheet
npm run test -- ingest
```

**Expected**: valid rows ingest, invalid rows land in `quarantined` with `rowNumber`, the poll
returns success. Assert that `temp_emp_id` is typed as `string` (never `number`), that a blank `id`
is rejected, and that a blank `cohort` becomes `null` and **not** `0`.

**Manual check**: load `/tracker`. The `fafsa`/`fasfsa` row must not appear as an employee; the
operator panel must report "1 row quarantined".

---

## Scenario 3 — The tracker never blanks (SC-008)

```bash
npm run test:e2e -- tracker
```

Covers, at both 360px and 1280px:

1. **No blank panel.** For every progress fixture, no `[data-state]` container has empty text.
2. **Three states stay distinct.** With one id mocked to `not_found` and one to a failure, assert
   58 rows render normally, one shows a mismatch flag, and one shows an inline error with retry —
   and the table is not replaced by a table-level error.
3. **Partial failure.** Mock 1 of 60 ids as a 500. Assert 59 rows render.
4. **Freshness is visible.** Assert an "updated Ns ago" element is present.

---

## Scenario 4 — Policy answers are grounded (SC-002, SC-003)

```bash
npm run test:e2e -- policies
```

Fixtures required — all three cases exist in the live workflow:

| Fixture | Upstream shape | Expected UI |
|---|---|---|
| `answered` | non-empty `answer` + `source` | answer text **and** visible `policy-source` |
| `empty-answer` | `status: "success"`, `answer: ""` | `UnansweredCard` visible; `policy-source` **absent** |
| `refusal` | answer contains "does not provide enough information" | `UnansweredCard` visible; phrase rendered **verbatim** |

**The critical assertion**: for the `empty-answer` fixture, the response MUST NOT reach the browser
as `{ status: "success", answer: "" }`. Assert the BFF emitted `status: "unanswered"`. If that
coercion is removed, this test fails — that is the intended guard.

---

## Scenario 5 — Authorization is server-side (FR-023)

```bash
npm run test:e2e -- authz
```

1. As `new_hire`, request `/api/tracker`. Expect **403**.
2. As `manager`, request `/api/tracker` for an employee outside their reporting line. Expect **403**.
3. As `new_hire`, request `/api/admin/new-hire`. Expect **403**.
4. As `new_hire`, confirm `/new-hire` and `/welcome` are absent from navigation **and** return 403
   when called directly. Nav absence alone is not the assertion — direct invocation is.

---

## Scenario 6 — No PII in any response (FR-024, SC-010)

```bash
npm run test -- pii
```

Assert the serializer is an **allowlist**: adding a `salary` column to the test sheet must not cause
it to appear in any API response. This test is written to fail if the serializer is ever changed to
a denylist.

---

## Scenario 7 — Audit precedes disclosure

```bash
npm run test -- audit
```

1. Force the audit-sheet write to fail, then request `/api/tracker`. Expect the read to **fail**,
   not succeed unlogged.
2. On a successful read, confirm a row exists with the acting user's email, the action, the
   employee id, and the disclosed fields.
3. Confirm `actor_email` comes from the session and cannot be client-supplied.

---

## Scenario 8 — Provisioning is safe (P4, SC-007)

```bash
ADMIN_CONTRACT_VERIFIED=false npm run test:e2e -- admin
```

With the flag off, `/new-hire` must be absent and `POST /api/admin/new-hire` must return 503
`CONTRACT_UNVERIFIED`.

Once the real contract is confirmed:

```bash
ADMIN_CONTRACT_VERIFIED=true npm run test:e2e -- admin
```

1. Submit valid details. Expect exactly one record and the created id echoed back.
2. Submit with a missing field. Expect 400 with the problem against that field, and no record.
3. **Double-submit**: fire two concurrent identical requests. Assert **one** record is created.

Scenario 8b is the most important test in the suite — it is the only path that creates real
employee records. Run it against a sandbox workflow, never production.

---

## Scenario 9 — Responsive (SC-006, FR-027)

```bash
npm run test:e2e -- responsive
```

At **360px**, 768px, and 1280px, for `/`, `/tracker`, `/tracker/[id]`, `/welcome`, `/policies`,
`/new-hire`:

1. No horizontal scrolling (`scrollWidth <= clientWidth`).
2. All interactive targets ≥ 44×44px on touch widths.
3. Tables below `md` render as cards — not as a horizontally scrolled table.
4. No text clipped or truncated unreadably.

---

## Scenario 10 — Design system renders every state

```bash
npm run dev   # then open /design-system
```

One route importing every component in all five states — `idle`, `loading`, `empty`, `error`,
`success` — plus `unanswered` for policies and the three tracker states. Confirm the blank-panel
invariant fires in development when a `success` state renders zero children.

---

## Full validation

```bash
npm run check:upstreams && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

**Release gates** (constitution §"Development Workflow & Quality Gates"):
- Zero failures in the blank-panel and source-provenance specs
- Zero PII leaks
- Zero unauthorized disclosures in the authz suite
- Upstream contract probe still matches `contracts/upstream-integrations.md`

A release proceeds only when all four hold.

---

## Known-blocked validations

| Scenario | Blocked by | Unblock via |
|---|---|---|
| 8 (provisioning) | `admin` contract unverified | Confirm the workflow's required field set |
| Stage ordering | Canonical stage enum owned by workflow | Confirm the vocabulary; map drift in the BFF serializer |
| Predictive analytics | No completion history in the sheet | Workflow persists `completed_essentials` |
| Policy deep links | `source` is a filename, not a URL | Build the filename → URL registry |

These are tracked in `plan.md` §Complexity Tracking and must not be quietly skipped during task
decomposition — each one silently changes behavior.

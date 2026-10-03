# Release Gate Verification (T082)

Verified: **2026-10-02**. Amended **2026-10-03** — the destructive-read hazard that
gated the `onboarding-progress` probes and kept `TRACKER_PROGRESS_FANOUT` off was
fixed and the fix proven end to end. See "The probe suite is no longer inert" below.
The four gates themselves are unchanged.

The four release gates from `plan.md`, each with the evidence that supports it. A gate
marked PASS below means the automated suite asserts the property, not that a human
eyeballed a page.

## Gate 1 — Zero blank-panel failures

**PASS.** A blank panel is the failure this product exists to prevent: it looks like a
working page and reads as "no one is onboarding" when the truth is "one lookup failed."

| Evidence | What it asserts |
|---|---|
| `tests/e2e/tracker.spec.ts` — 10 blank-panel tests | No `[data-state]` container on any of 5 routes, at 360px and 1280px, renders with empty text. Runs against a fixture carrying all three row states plus a quarantined row. |
| `tests/e2e/tracker.spec.ts` — error panel | An error panel states *what failed* and offers a retry, rather than showing nothing. |
| `tests/e2e/tracker.spec.ts` — loading panel | A loading panel sets `aria-busy="true"` and occupies real height, so it is never mistaken for empty. |
| `src/components/data-state/DataState.tsx:54` | In development, a `success` state with no content **throws**. The invariant is enforced at runtime, not just in review. |
| `src/app/page.tsx`, `src/app/tracker/page.tsx`, `src/app/welcome/page.tsx` | Every surface is wrapped in `DataState`; there is no render path that can emit an unwrapped panel. |

### A second blank-panel shape, found 2026-10-03: a panel that renders *confidently*

Gate 1 above is about panels that render **empty**. This was a panel that rendered
**confidently and wrongly**, which passes every assertion in the table above and is worse.

With `onboarding_stage` blank — which is the state the sheet is being operated in — the
`onboarding-progress` webhook returns, for the one real employee:

```
completed: []   outstanding: []   completed_count: 0   total_items: 3   checklist_source: "none"
```

`completed` and `outstanding` are both empty, which is **byte-identical to a finished
checklist**. `OutstandingList` rendered that as *"Nothing outstanding. All items complete."*
beside a *"0 of 3 items complete"* hero — self-contradictory, and telling a real new hire they
had finished onboarding when nothing was being tracked at all. `checklist_source` existed
precisely to prevent this (`schemas.ts` even said so) but was parsed by the schema and then
**dropped at the mapping boundary**, so the UI could never see it.

| Evidence | What it asserts |
|---|---|
| `src/lib/n8n/classify.ts` | `checklistSource` is carried through, narrowed to the two documented values or `null`. Unknown stays unknown — an absent field is never coerced to `"none"`, which would make every older payload claim no checklist exists. |
| `src/components/tracker/Progress.tsx` — `hasNoChecklist()` | `checklist_source: "none"` renders "This is missing data, not zero progress" and names the real `totalItems`, so the panel cannot read as "nothing to do". |
| `tests/unit/progress-honesty.test.tsx` — 9 tests | The two empty lists never produce "All items complete" when no checklist exists; and the legitimate completed state still does. The fix must not swallow the real "all done" case — that boundary is pinned in both directions. |
| `tests/fixtures/index.ts` | Both shapes are stored as **verbatim observed payloads**, not hand-written mocks. |

The general lesson, and the reason this is recorded rather than just fixed: an empty-state
message is a **claim about the world**, and it needs its own evidence. "All items complete" is
true of an empty checklist and false of a missing one, and no amount of test coverage on the
rendered component distinguishes them — only the upstream field does.

## Gate 2 — Zero grounding failures

**PASS.** The constitution's obligation is that no answer reaches a user unless it came
from the policy document.

| Evidence | What it asserts |
|---|---|
| `tests/unit/policy-classify.test.ts` — 10 tests | `status:"answered"` requires **both** a non-empty answer and a source. The workflow's own refusal is mapped to `unanswered`, never reworded into an answer. A whitespace-only answer is `unanswered`. |
| `tests/unit/policy-route.test.ts` — 5 tests | The upstream vocabulary never reaches the browser: the route emits no `success` status, no `success`-paired-with-empty-answer, and no `answered` without a source. |
| `tests/unit/welcome-classify.test.ts` | `already_sent` is idempotent success; `email_sent:false` is not reported as a new send. |
| `src/components/policies/AnswerCard.tsx` | An unanswered result renders a human path to a person, not a blank and not a fabricated answer. |
| `npm run probe:upstreams` — 8/8 live | Confirms against the real workflow that `policy` returns `source` as a **filename** (`hr_document.md`) and that empty answers still arrive as `status:"success"`. |

The live probe matters because the empty-answer trap drifts silently: the workflow
returning `status:"success"` with `answer:""` would otherwise pass every happy-path test
and produce a confidently blank answer.

## Gate 3 — Zero PII leaks

**PASS.** Compensation, health, benefits elections, and government identifiers must not
appear on any surface.

| Evidence | What it asserts |
|---|---|
| `tests/unit/pii.test.ts` — 5 tests | The serializer is an **allowlist**. A `salary` column added to the fixture sheet is dropped at the mapping boundary, never reaches ingest, and appears in no response. `containsProhibitedField` is itself tested against a known-bad payload, so the guard cannot silently become a no-op. |
| `src/lib/serializer/employee.ts` | Disclosure is `DISCLOSABLE_FIELDS`, an explicit positive list. Adding a sheet column requires a deliberate code change to expose it. |
| `src/lib/contracts/schemas.ts` — `SHEET_COLUMN_MAP`, `mapSheetRow()` | Unknown columns are dropped at the boundary rather than spread-copied onto the row. |
| `npm run check:upstreams` | Fails if any secret carries a `NEXT_PUBLIC_` prefix, which would ship credentials to the browser bundle. |

The `salary`-column test is written specifically to fail if the serializer is ever
converted to a denylist — with a denylist, adding a `salary` column exposes it to every
employee until someone remembers to block it.

## Gate 4 — Zero unauthorized disclosures

**PASS.** Authorization is enforced server-side, independently of what the interface
renders.

| Evidence | What it asserts |
|---|---|
| `tests/e2e/authz.spec.ts` — 14 tests | Direct **route invocation**, not nav absence: `new_hire` is refused `/api/welcome`, `/api/admin/new-hire`, and stage updates; `manager` is refused provisioning and any employee outside their reporting line. Unauthenticated callers get 401/403 on all routes. |
| `tests/e2e/authz.spec.ts` — forgery resistance | A client-supplied `actor_email` never appears in any response; a client-supplied `temp_emp_id` or `totalEssentials` is rejected. |
| `tests/unit/auth.test.ts` — 16 tests | Scope filtering per role: a new hire resolves to exactly one row, a manager to their reporting line, hr_admin to the whole roster. Session tokens are rejected when tampered, malformed, or of wrong signature length. |
| `tests/unit/audit.test.ts` — 2 tests | The audit write **fails the read** rather than serving unlogged data, and an unconfigured audit sink fails closed instead of being silently skipped. |

### Two authorization defects found and fixed during this verification

These were found by the Gate 4 suite, not by inspection:

1. **`GET /api/tracker` disclosed the entire roster to every authenticated role.**
   `new_hire` and `manager` are correctly permitted onto the tracker *module*, but the
   fan-out iterated the full ingested roster with no record-level filter — so a new hire
   received every employee's name, role, cohort, email, and start date. Module access was
   being treated as record access. Fixed by filtering the roster through
   `canViewEmployee` before the audit write, so a record outside scope is never disclosed
   and never logged as disclosed (`src/app/api/tracker/route.ts`).

2. **`GET /api/tracker/[id]` called `assertEmployeeAccess(session, id)` without `selfId`.**
   A new hire could therefore never read *their own* record — `canViewEmployee` had no
   way to identify them and could only refuse. `Session` gained an optional `selfId`,
   populated at sign-in from the identity provider and never from the client.

   `POST /api/tracker/[id]/stage` deliberately still omits `selfId`: passing it there
   would let a new hire advance their own onboarding stage and mark themselves hired.
   The asymmetry is now commented at the call site so a future signature change does not
   grant it accidentally.

## Suite results

Recorded 2026-10-03 in a CONFIGURED environment (`.env.local` present).

```
check:upstreams   12 passed, 7 warnings, 0 failures
lint              No ESLint warnings or errors
typecheck         clean
unit              20 files, 214 tests passed
build             21 routes compiled (incl. /login + 5 auth routes)
probe:upstreams   9 passed, 0 skipped
verify:progress   12 passed, 0 failed (gate proven against test row 1302)
ui (live)         6 routes hydrated, 0 blank panels, 0 page errors, 1280px + 360px
auth (live)       passcode login -> 4 live rows; lockout at 6; logout clears
```

`check:upstreams` fails closed in an UNCONFIGURED environment — it requires `N8N_BASE_URL`,
`SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `AUDIT_SHEET_ID`, and a 32-character `SESSION_SECRET`
before it will report the app ready to serve employee data. Two corrections since this table was
first written:

- It used to report **5 failures in a fully configured environment**, because the script never
  loaded `.env.local`; Next.js populates `process.env` for the app but a bare `tsx` script gets
  nothing. It now loads the file itself. If you ever see it fail on a working deployment, suspect
  this before the deployment.
- It no longer claims the `admin` contract is unverified. That contract was confirmed against
  `Validate New Hire1` on 2026-10-02; the flag stays off because the provisioning form is a
  placeholder with no `tempEmpId` field.

### The probe suite is no longer inert — the hazard that made it so is fixed

Until 2026-10-03 the `onboarding-progress` probes were gated behind
`PROBE_ALLOW_SHEET_WRITES`, because that webhook contained an active googleSheets
node, `Update Onboarding Stage`, that wrote an **empty string** to the sheet's
`onboarding_stage` column on any read that omitted the field. The script
previously claimed to be read-only and blanked the column for `PROBE_EMP_ID`
(default `1201`, a real employee) on every run. The same defect made
`GET /api/tracker` wipe the column once per employee every 30s, which is why the
app shipped with `TRACKER_PROGRESS_FANOUT` off.

**That node is now gated behind `requested_stage_update`, and the gate is proven
rather than assumed.** A `'' -> ''` write is invisible, so proving it required a
non-empty value; rather than grant the Viewer-only service account write access
just to run a probe, `npm run verify:progress` seeds the value through the
workflow's *own* write path — the path under test — so the probe needs no
permission the service account does not already have:

| Step | Request | Expected | Observed |
|---|---|---|---|
| 1 | `{temp_emp_id:"1302", onboarding_stage:"Not Started"}` | the cell now holds a value, so a later blank cannot hide | `Not Started` |
| 2 | `{temp_emp_id:"1302"}` — a plain read | the gate does **not** fire | `Not Started` preserved |

Then, end to end: `TRACKER_PROGRESS_FANOUT=true` and a real `GET /api/tracker`
covering all four roster rows. **Column I was byte-identical before and after.**
Under the old workflow that single request would have blanked all four rows.

Two consequences now hold:

- The three probes are **un-gated** and the suite reports `8/8`, no skips. Leaving
  them gated would have kept the onboarding-progress contract permanently
  UNVERIFIED by tooling for a hazard that no longer exists.
- `TRACKER_PROGRESS_FANOUT` is enabled. The flag is retained as a **kill switch,
  not a mitigation** — a workflow edit can regress the gate silently, and setting
  the flag to `false` restores the old behaviour with no code change or deploy.
  It defaults to off so an environment that never opted in cannot start issuing
  per-employee reads.

`PROBE_ALLOW_SHEET_WRITES` is still read by the script, but only to warn that it
no longer has any effect. A stale value in someone's `.env.local` or CI config
should not become a confusing "unknown flag" failure.

The `welcome` probe is unchanged and still conditional, because its danger is
real and independent. The welcome workflow's `Welcome Already Sent?` node tests
`welcome_status === "welcome_sent"` exactly (case-sensitive). On a match it
short-circuits to `already_sent` with no email and no write; on ANY other value —
blank, `pending_welcome`, different casing — it generates a message, **sends a
real email**, and writes the column via `Update Status`. So rather than gate it
away, the probe **reads `welcome_status` from the sheet first** and calls the
webhook only when the call provably cannot send. If the row cannot be read, or is
not already marked sent, the check reports SKIP with the reason.

Re-run `npm run verify:progress` after any edit to the onboarding-progress
workflow. It refuses to run its gate proof against a real employee id.

The single skipped E2E test is the desktop-table branch at 1280px, which requires a
reachable roster. It skips explicitly with that reason rather than passing vacuously or
failing as a false layout defect.

## Sign-in, added 2026-10-03 (T083) — the last deploy blocker

**The problem it solves.** The app had no authentication entry point at all: eight
API routes, none for sign-in, no middleware. Every page returned 200 and every API
returned 401 `UNAUTHENTICATED` for a real visitor. It failed closed, which was
correct, and it was also **unusable in a deployed environment** — no matter how well
the rest of the portal worked.

### Identity and authority are deliberately separate

A verified Google account proves **who someone is**, never **what they may see**.
If the IdP could grant a role, anyone able to create a Google account would inherit
HR admin over live employee data. So:

| Concern | Source |
|---|---|
| Identity | the verified `email` from Google's `id_token` |
| Authority | `HR_ADMIN_EMAILS` / `MANAGER_EMAILS` in the environment |
| Employee existence + scope | the roster, matched by `emailID` |

Roles are **never** read from the IdP, a form field, or the sheet's `role` column.
That column holds job *titles* ("Developer - Lead") and is in the webhook's
`WRITABLE_COLUMNS`, so an access role there would be self-granting by an Apps Script
call. Verified by test: signing in as `hr_admin@company.com` grants nothing when the
allowlist is empty.

### The callback's order of operations is the security property

| # | Check | Fails as |
|---|---|---|
| 1 | Google's own error passthrough | `access_denied` / `oauth_error` |
| 2 | `state` matches the cookie this browser was issued | `state_mismatch` |
| 3 | PKCE verifier present | `missing_verifier` |
| 4 | `code` exchanged at Google's token endpoint | `verification_failed` |
| 5 | **`id_token` verified** by `verifyIdToken` — signature, issuer, audience, expiry | `verification_failed` |
| 6 | `email_verified === true` | `email_not_verified` |
| 7 | Role resolved from the allowlist | `not_recognized` |
| 8 | HttpOnly session cookie set | — |

Two of these are easy to skip and impossible to notice afterwards. **Step 5**:
*decoding* a token without verifying it lets anyone mint an admin session. **Step 6**:
Google marks unclaimed `@gmail.com` aliases `email_verified:false`; treating those
as identity lets anyone claim an unclaimed address and inherit its access.

A roster read failure **refuses** sign-in rather than falling back to a permissive
role — refusing is recoverable, silently granting `hr_admin` is not.

### Verified live, without real credentials

Placeholder credentials were added temporarily, the flow exercised, then removed —
no real secret was ever written.

| Check | Observed |
|---|---|
| `/api/auth/google` redirect | correct endpoint with `response_type=code`, `scope=openid email profile`, random 256-bit `state`, PKCE `S256` challenge, `prompt=select_account` |
| Flow cookies | `portal_oauth_state` + `portal_oauth_pkce`, `HttpOnly`, `SameSite=lax`, 600s TTL |
| Callback, no cookies + attacker's `state` | `state_mismatch`, both flow cookies cleared |
| Callback, no `code` | `missing_code` |
| Callback, `error=access_denied` | passed through with the reason, not masked |
| **Callback, VALID `state` + cookies + bogus `code`** | `verification_failed`, **no session issued** — `/api/auth/session` still `authenticated:false` |
| `/api/auth/logout` via GET | **405** — POST only, so no `<img src>` can sign a user out |
| `/login`, unconfigured | names `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, renders **no** dead button |
| `/login`, configured | renders the button |

`tests/unit/identity.test.ts` — 21 tests, mostly about what must be **refused**:
unrecognized addresses, roster rows with no email, an unreadable roster, an empty
email, a `hr_admin@company.com`-looking address, and
`hr.admin@company.com.evil.com`.

### What the operator must do

`check:upstreams` **fails** when no sign-in method is configured, because that makes
the portal unusable rather than merely degraded.

**Fastest — passcode (no Cloud project, no admin needed):**

```bash
npm run auth:passcode          # prints the passcode ONCE, plus a hash
```

Put the **hash** in `HR_ADMIN_PASSCODE_HASH` in `.env.local`. Never put the passcode
itself there. Rerun the command to rotate; the old hash stops working immediately.

**Preferred — Google**, once an admin creates the client:

1. OAuth 2.0 **Web application** client in Google Cloud Console.
2. Authorized redirect URI must match `GOOGLE_OAUTH_REDIRECT_URI` **exactly**,
   including trailing slash.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and
   add your address to `HR_ADMIN_EMAILS`.

Local development is unaffected: `npm run dev:session` still mints a session cookie
with the same HMAC the app verifies.

### Passcode fallback, added after Google OAuth proved blocked

Registering an OAuth client requires Cloud project permissions that a Workspace
**admin** holds; an individual operator gets a permission error at "Create
Credentials → OAuth client ID". That is a legitimate block, not a misconfiguration,
so a second sign-in method was added rather than leaving the app unusable.

`POST /api/auth/passcode` issues the **same signed session cookie** as the Google
flow, so nothing downstream knows which door the user came through.

| Property | Choice |
|---|---|
| Storage | scrypt (`N=16384`), **hash only** — a leaked config file hands over no login |
| Verification | `timingSafeEqual`; every configured hash evaluated with **no early return**, since scrypt's cost would otherwise leak *which role* matched by timing |
| Rate limit | 5 attempts / 15 min per client address (~20/hour — not a search) |
| Response | a wrong passcode and a matching-nothing passcode return the **identical** 401, so valid passcodes cannot be enumerated |
| Session identity | `passcode:<role>` — **no fabricated email**, so nothing invented reaches the audit trail |

**What a passcode cannot do, stated plainly:** it authenticates a shared secret, not
a person. `selfId` requires knowing *which* employee the user is, so a passcode
cannot open an individual's own record. Per-employee self-service still requires
Google OAuth. Granting `manager` scope to every new hire to work around this would
be exactly the wrong trade.

### Two real bugs this surfaced

**1. dotenv silently truncated the hash.** The scrypt hash was formatted
`scrypt$16384$8$1$salt$hash`. dotenv expands `$`-sequences inside `.env` values, so
the process received `scrypt$16384$8$1$-vYExZGHeCogtZY6nCBDnw` — **the final field
dropped entirely**. Every passcode was rejected forever, with no error logged
anywhere and no clue in the response. Measured with `@next/env` to confirm rather
than guess. Fixed by switching the separator to `:` (inert in dotenv), with a
regression test asserting the hash survives a `.env` round trip and contains no `$`.
Do not "tidy" the separator back.

**2. The in-memory rate limiter does not hold under `next dev`.** Six wrong attempts
never tripped the limit, while the identical production build locked out correctly on
attempt 6. Next's dev server re-evaluates modules between requests, so the bucket
`Map` resets. The limiter is real in production but **will not survive more than one
instance or a serverless runtime** — documented in the module and surfaced by
`check:upstreams` rather than assumed away.

### Verified live against the production build

| Check | Observed |
|---|---|
| Correct passcode | `200 {"ok":true,"role":"hr_admin"}`, session issued |
| `/api/auth/session` | `authenticated:true`, `role:hr_admin`, all 5 modules permitted |
| That session's real access | `/api/tracker` **4 rows**, `/api/welcome` **4 rows** — live sheet data |
| Wrong passcode ×5 | `401 invalid_passcode`, identical wording each time |
| Wrong passcode ×6 | `429 rate_limited`, `Retry-After: 900` |
| **Correct** passcode after lockout | still `429` — a lockout is not bypassable with the right answer |
| Different client address | own bucket, succeeds independently |
| `POST /api/auth/logout` | `303`, session cleared → `401` |

`tests/unit/passcode.test.ts` — 22 tests covering hashing, malformed-hash denial,
NFKC normalization, look-alike-free generation, role resolution, and the limiter
(including that `peek` cannot extend a lockout by probing).

## UI validation, 2026-10-03 (live, real data, real browser)

Driven with the project's own Playwright **chromium** (installed) — the MCP browser
demands a Chrome channel that is not present, so the Chrome-based path was
abandoned rather than downloading a browser. Every route was loaded as `hr_admin`
with a real signed session cookie, waited past its loading state, and inspected for
console errors, page errors, failed requests, and `[data-state]` panels that
rendered empty.

**Result: no blank panels, no page errors, on any route, at 1280px or 360px.** Six
routes hydrate live data: `/` (success), `/tracker` (4 rows), `/tracker/1201`,
`/tracker/1302`, `/welcome` (4 rows), `/policies`.

### Three defects this found that no fixture could

| Defect | Why fixtures missed it |
|---|---|
| `/tracker/[id]` rendered **"Stage: Not started"** for an employee with no recorded stage, while the tracker's own Stage column showed an em dash | Every fixture carried a stage, so the `?? "Not started"` fallback never executed |
| `DetailPayload.employee` omitted `stage` from its type although the route has always returned it | A type error only surfaces at compile time, and nothing referenced the field |
| `NavDrawer` had **no `<nav>` landmark on desktop** — only the mobile drawer had one | Landmarks are invisible to route-level and unit assertions |

The stage fallback is the same class of failure as the checklist one above: an
affirmative claim built from an absence, in a different place. Both now share a
rule — an empty value is missing data, never an inference. Fixed at
`src/app/tracker/[id]/page.tsx` (reads `employee.stage`, matching the table and its
three sibling fields), pinned by `tests/unit/stage-honesty.test.tsx`.

### A dev fixture that had never worked

`scripts/mint-dev-session.ts` minted the third role as `employee`, which is not a
valid `Role` (`hr_admin | manager | new_hire`). Every request made with that cookie
was refused with 403, so **the new-hire view of the UI was never actually reachable**
— it looked like a working fixture and exercised nothing. The app was right to refuse
it; the fixture was wrong. Its `manager` scope was also `['EMP001','EMP002']`, which
matches no `temp_emp_id` in the roster. Both corrected, and `selfId` is now minted so
a new hire can resolve their own record.

### Authorization, verified live against real roles

| Check | Observed |
|---|---|
| `/tracker` as `new_hire` | **1 row** — only their own record, not the 4-row roster |
| `/tracker/1201` as `new_hire` (own record) | 200, renders |
| `/tracker/1301` as `new_hire` | 403 `employee record is outside your scope` |
| `/welcome` as `new_hire` | 403 `role "new_hire" cannot access welcome` |
| `/tracker` as `manager` scoped to `[1201]` | **1 row** |
| `/tracker/1302` as `manager` | 403 `employee record is outside your scope` |

This is the live confirmation of the Gate 4 fix: a new hire can read their own
record and nothing else. Module access is no longer record access.

### Mobile (360px) and the drawer

No horizontal overflow; no blank panel; the desktop sidebar correctly hidden and the
hamburger present. The drawer is `role="dialog"` `aria-modal="true"`, labelled,
contains 5 links, locks body scroll, moves focus inside on open, and **Escape closes
it and restores focus to the trigger** — so it is not a keyboard trap.

### The Policy Hub is unreliable, and it is an upstream defect

Not fixed here, because the fix is inside the workflow's retrieval:

1. **The workflow is non-deterministic for natural-language questions.** The same
   question over 6 consecutive calls answered 4 times (745–904 chars) and returned
   `""` twice — always at `status: "success"`. Short keyword queries were stable
   across 6 runs. Users type natural-language questions, so they hit this.
2. **All four questions suggested on `/policies` are unanswerable** against
   `hr_document.md`: two return an empty answer, two return the workflow's own
   refusal. A user landing on the hub therefore reaches "no policy covers this" on
   every path the UI offers, which reads as a broken feature.

The BFF handles both correctly — empty and refused answers both map to
`status: "unanswered"` with a human path to a person, never to a fabricated answer —
so Gate 2 holds. But the feature is unreliable, and `check:upstreams` now warns
about it on every run. Replacing the suggestions requires reading `hr_document.md`
to learn what it actually covers; guessing would repeat the mistake this project has
already made once.

### One feature deliberately not exercised

`POST /api/tracker/[id]/stage` writes `onboarding_stage`, and the only employee is a
real person whose column I is being operated as-is by decision. It stays covered by
the unit suite rather than by a live write.

## What these gates do NOT cover

Stated plainly so the PASS is not read as broader than it is:

- **The UI is now verified against live data and a real browser** (2026-10-03) — see
  "UI validation" above. What remains unverified is stated there: the Policy Hub's
  upstream retrieval is non-deterministic, its suggested questions are unanswerable,
  and the stage-update write path was not exercised live.
- **Provisioning is disabled and unverified.** `POST /api/admin/new-hire` returns
  `503 CONTRACT_UNVERIFIED` unless `ADMIN_CONTRACT_VERIFIED=true`. The required field set
  is still unknown (`{}` and `{"name":"probe"}` both return 400), so no live create has
  been attempted and T064 remains open. The UI renders "Provisioning is temporarily
  unavailable", which is correct.
- **Sheet column I is empty and is being operated as-is, by decision.** The destructive-read
  defect that emptied it is fixed and nothing will empty it again — but fixing the bug does not
  restore what it destroyed, and as of 2026-10-03 the sheet is being used in its current state
  rather than recovered from version history. Consequences, all accepted:
  `onboarding_stage` is blank for every row except the 1302 test row, so the tracker's Stage
  column is empty for real employees; `completed_essentials` is a formula over column I so it is
  blank too; and the workflow reports `checklist_source: "none"`. The three test rows
  (`1202`, `1301`, `1302`) are also still present and still render beside the one real employee.
- **Three open risks remain**, and all three are outside this codebase: there is no delete path
  for a mis-provisioned hire (open risk 4); the `onboarding_stage` value set is still unverified
  against the workflow's accepted values, so a stage update can be written that the workflow will
  not recognise; and the sheet's sharing settings could not be confirmed from here — anonymous
  access now returns a generic 404, which suggests link-sharing was revoked, but that needs
  checking in a signed-out browser (open risk 3).

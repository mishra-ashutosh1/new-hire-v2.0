# Phase 0 Research — People Operations Portal

**Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

Two research tracks ran in parallel: frontend stack/BFF patterns, and Google Sheets SSOT ingestion.
All `[NEEDS CLARIFICATION]` items from Technical Context are resolved below.

---

## 1. React framework

**Decision: Next.js 16 App Router, self-hosted Node container.**

**Rationale:** The BFF is not optional. The sheet is link-shared with write implied, so a
service-account key must never reach the browser, and role authorization must be enforced *before*
data is fetched rather than filtered from text a model has already seen. That puts a server in the
request path unconditionally. Next.js colocates the BFF as Route Handlers and Server Actions, so
credentials stay server-side behind the `NEXT_PUBLIC_` compile-time boundary, and PII redaction
lives in one serializer layer. It also wins on first paint: the dashboard and `/policies` shells are
largely static, so Server Component streaming renders without shipping a client bundle.

**Alternatives considered:**
- *React Router v7 (ex-Remix)* — genuinely equivalent loaders/actions and arguably more
  transparent caching. Rejected because its RSC support is still `unstable_*` and single-fetch
  caching is a moving target, which means re-implementing much of Next's cache semantics. Worth
  revisiting if the team is already Remix-fluent.
- *Vite SPA + separate API* — disqualified. Requires a second deployable and two origins for an
  internal tool, and reduces credential handling to a hand-rolled server that must be maintained
  and patched independently.

**Hosting:** container, not Vercel. The app must reach a private n8n instance and a service-account
Sheets API; egress control and the "no PII to third-party infrastructure" obligation both point at
self-hosting.

---

## 2. Server vs client component split

**Decision: hybrid, with a hard boundary.** Server Components for auth, layout, navigation, the
dashboard, and the roster shell. Client components for everything under `/tracker`, `/welcome`, and
the policy search box.

**Rationale:** RSC is excellent at fetch-once-render-once and genuinely poor at the tracker's
shape. Per-row independent loading makes each row a unit of state that resolves on its own
schedule, and RSC has no primitive for that. Polling is worse: `router.refresh()` re-runs the
entire route's server tree, so a 30-second tick re-renders everything with no per-query cancel,
dedupe, or stale-while-revalidate. TanStack Query supplies per-query state, `refetchInterval`,
`refetchOnWindowFocus`, and per-query retry directly.

Note: RSC's PII advantage is small here, because the browser receives only what a client component's
props already contained. Redaction therefore belongs in the BFF serializer regardless of split.

**Alternatives considered:** pure RSC with `router.refresh()` — simpler dependency list, worse
tracker. Pure client-side — fine, but gives up SSR for nothing.

---

## 3. Fan-out strategy for the N-request tracker

**Decision: server-side batch aggregation endpoint, TanStack Query on the client.**

`GET /api/tracker` reads the cached roster, issues `onboarding-progress` for each id at concurrency
6, and returns `Promise.allSettled`-shaped results as a discriminated union:

```ts
type RowResult =
  | { id: string; state: "success"; data: ProgressDTO }
  | { id: string; state: "not_found" }
  | { id: string; state: "error"; message: string };
```

**Rationale:** This resolves both halves of the question at once. The browser makes one request, and
partial failure becomes a *value* in the response rather than an exception. `Promise.all` on the
server would blank the table when one row fails — the exact failure mode FR-021 forbids. Encoding
`status` as a discriminated union also makes the mandatory three-way branch unrepresentable-wrong:
there is no fourth case to forget.

**Alternatives considered:**
- *React `cache` + fetch revalidate* — request-scoped memoization only. Cannot dedupe across users,
  so every open tab re-hammers n8n.
- *SWR* — a fine, smaller alternative; choose it if the dependency is unwanted, since only
  `refreshInterval` and per-key state are needed.
- *Plain `useEffect` + `setInterval`* — genuinely sufficient if the app stays tracker-only. TanStack
  Query earns its place because the same cache serves `/tracker/[id]`, `/welcome`, and
  post-mutation invalidation. If task decomposition narrows scope to one page, drop it.

---

## 4. Polling architecture

**Decision: client-side interval polling against `/api/tracker`, paused on `document.hidden`.**

**Rationale:** SSE and WebSockets are *push transports* — they solve delivery, not production.
Nothing upstream emits an event: the sheet is polled via the Sheets API and n8n webhooks respond to
requests only. SSE here would be a long-lived connection whose server still loops on a timer,
buying reconnect handling and proxy complications (many corporate networks buffer SSE) for zero
latency gain. A server-side scheduled aggregator is actively wrong at this scale: with ~60
employees and 30-second freshness, a cron-warmed cache is a stale-cache bug waiting to happen, and
cron is not durable in a container deployment.

Polling matches the data: bounded N, per-row timeout 10s, one retry with jitter on 5xx only.
Never retry 4xx. The countdown is displayed, because silent refresh is precisely the dishonesty
the constitution targets.

**Alternatives considered:** SSE — reconsider only if n8n gains an on-change webhook the BFF can
receive and relay. WebSockets — never; bidirectional communication is out of scope.

---

## 5. Styling

**Decision: Tailwind CSS v4 (CSS-first `@theme`) + shadcn/ui as copy-paste source, with the
design-system tokens as the single source of truth.**

**Rationale:** The token set is already specified as CSS custom properties (`--surface-canvas`,
`--text-body`, `--status-*`). Tailwind v4's `@theme` block maps that exact shape into utilities —
`bg-surface-raised`, `text-text-secondary`, `border-border-subtle` — with no JS config and no
runtime. Tokens live in `globals.css`; shadcn components are generated into `components/ui/` and
then edited to reference *our* tokens, so the library never becomes a second design system. Status
colors compose as `bg-status-success/14 text-status-success`, matching the badge recipe.

**Alternatives considered:** *vanilla-extract* — better type safety and true zero-runtime, but adds
a build-time layer and a second token definition site for a dark-only system whose tokens are
already written. *CSS Modules* — fine, but no token-to-utility bridge, so the badge recipe gets
hand-written in every file. *shadcn without Tailwind* — does not exist; shadcn is a Tailwind
distribution.

---

## 6. Tables

**Decision: TanStack Table v8 (headless) above `md`; the identical row model rendered as stacked
cards below `md`.**

**Rationale:** Responsive tables are a layout decision, not a library feature. Current practice is
progressive disclosure via `useMediaQuery('(max-width: 767px)')`: above the breakpoint a real
`<table>` with sticky header and sortable columns; below it, the same row data as a card list with
label/value pairs. TanStack supplies sorting, filtering, and column-visibility state for both modes
from one column definition while imposing zero styling opinions — correct, since the design system
already specifies sticky headers, 48px rows, and 4% zebra.

Virtualization is explicitly unnecessary at ~60 rows.

**Alternatives considered:** *AG Grid* — rejected on bundle size, licensing friction, and a weaker
mobile story. *Hand-rolled entirely* — defensible for three static columns, but sorting and
filtering get rebuilt within a month. *Horizontal scroll as the mobile strategy* — the explicit
anti-pattern.

---

## 7. Forms and validation

**Decision: React Hook Form + Zod, with the schema shared between client and BFF.**

**Rationale:** Two forms exist. RHF is the mature default — uncontrolled-first, no dependencies,
best-in-class error ergonomics. Zod is the load-bearing half: `adminRequestSchema` lives in a
shared contracts module, drives client validation via `zodResolver`, and is imported by the BFF
Route Handler to validate before forwarding to n8n. That single definition is how the unverified
admin contract was contained — when the real field set is confirmed, one file changes.

**Resolved 2026-10-02 (T064).** The contract is now confirmed and `adminRequestSchema` has been
updated, and it did prove to be one file plus its tests — but the correction was not cosmetic. The
provisional schema had rejected a client-supplied `temp_emp_id` and `totalEssentials` and required
`startDate`, on the assumption that those fields were workflow-generated. The live
`Validate New Hire1` node requires `temp_emp_id` **from the client**, copies `total_essentials`
through when present, and requires neither `start_date` nor any optional field. Enabling the flag
against the old schema would have returned 400 on every real provisioning call. `/new-hire` remains
behind `ADMIN_CONTRACT_VERIFIED`; the contract being confirmed is not the same as the endpoint being
safe to enable, since it has no dry run and its workflow sends a real welcome email.

**Alternatives considered:** *TanStack Form v1* — stable and better typed, but more boilerplate and
an async-validation debounce this app does not need. *Plain controlled state* — rejected; it loses
touched/dirty tracking on the one form that creates a real employee record.

---

## 8. Testing strategy

**Decision: Vitest + React Testing Library for units, Playwright for two invariant specs.**

Both constitutional properties — "never a blank panel" and "every answer shows its source" — are
best enforced as assertions inside components rather than as E2E text greps. Build one `<DataState>`
wrapper covering the five states with a dev-only invariant: if status is `success` and no children
rendered, throw. In `AnswerCard`, if status is `success`, answer is non-empty, and source is blank,
render the unknown card and mark the branch unreachable in tests. This converts UI conventions into
compiler-enforced branches.

**Playwright specs** against mocked webhook routes:
- *No blank panel* — for each policy and progress fixture, assert no `[data-state]` container has
  empty text, at 360px and 1280px.
- *Source always present* — for every successful non-empty answer, assert the source element is
  visible and non-empty; for the empty-answer fixture, assert the unanswered card renders *and*
  the source element is absent.
- *Partial failure* — mock 1 of 60 ids as a failure; assert 59 rows render and one shows an inline
  error with retry, not a table-level error.

---

## 9. Sheet read method

**Decision: Google Sheets API v4 (`spreadsheets.get`) with a service account, called server-side
only, pinned to `Sheet1!A1:J` with a `fields` mask.**

**Rationale:** It is the only option with a stable contract, typed errors, quota accounting, and
write capability under one credential. Pinning the range is load-bearing: reading the whole
workbook would pull in the Sheet2 mirror and double every employee.

| Method | Server credentials | Verdict |
|---|---|---|
| Sheets API v4 + service account | yes (n8n tier only) | **use** |
| `export?format=csv` | none | reject |
| Apps Script web app proxy | service account inside script | reject — extra runtime, extra execution quota, another deploy target |
| gviz endpoint | none | reject — undocumented, HTML-parsing fragility, no error semantics |

**The CSV export is not a credentials problem; it is a PII problem.** Zero-credential access sounds
safer, but it means names, work emails, cohorts, and start dates are readable by anyone who obtains
the URL — and URL-shared Google documents are forwarded and indexed constantly.

**Minimal hardening (~15 minutes):** restrict sharing to the organization; share with the
service-account address as Viewer; add an n8n read timeout and alert on unexpected 4xx; keep the
service-account key in n8n credentials only, never in the client bundle or a committed `.env`.

---

## 10. Sheet rate limits

**Decision: no throttling required. Implement 429 retry regardless.**

Documented limits are 300 requests/minute/project and 60/minute/user/project for both reads and
writes, refilled per minute, with no daily cap. A full sheet read is a **single request regardless
of row count**, so row count consumes no extra quota. 100 employees polled every 30 seconds is 2
requests/minute — roughly 0.7% of the project pool. Even ten concurrent pollers at 30s is 20/min.
Writes will be single-digit per minute. Quota work belongs on the roadmap only if polling moves to
sub-second intervals or the tool is exposed outside the company.

---

## 11. Ingestion and validation

**Decision: Zod, with per-row `safeParse` and an explicit quarantine channel.**

**Rationale:** The failure mode that kills ingestion is array-level parsing — one garbage row
(`fafsa`/`fasfsa`) throws and takes down the entire poll, which is now verified live data. Instead:
iterate rows, `safeParse` each, push successes into `employees` and failures into
`quarantined: [{ rowNumber, raw, issues }]`. The poll always succeeds, and the UI reports "N rows
quarantined" for HR to fix. Never auto-delete from the sheet — HR owns that data.

**Mixed types:** a `z.preprocess` that trims, maps `""` to `undefined`, then
`z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])` for numeric columns. For
`temp_emp_id`, **do not coerce to number** — treat it as a canonical trimmed string key and require
presence. A blank id is the one hard reject, because every downstream lookup keys on it. Add
email as a secondary fallback key so a blank-id row stays reachable rather than becoming invisible.

**Dates:** `start_date` is ISO text, not a serial. Read with `valueRenderOption=FORMATTED_VALUE` and
validate against an ISO regex plus a real-calendar check. Do not use `UNFORMATTED` — it would
return serials for any cell an HR user later reformats as a true date, silently changing the type
underneath the application.

**Empty columns:** `completed_essentials` and `onboarding_stage` are optional with defaults, and
progress is derived from the webhook rather than read from the sheet. Log the gap as a data-source
limitation, not a validation error.

**Alternatives considered:** Valibot — smaller and faster with a weaker ecosystem and near-zero
practical benefit at this size. Joi — schema-in-JSON, heavier, dated. TypeBox — attractive for
static types from the same schema, but adds codegen for no runtime gain.

---

## 12. Caching

**Decision: in-process TTL cache (60s) plus `If-None-Match` conditional GETs. No Redis, no
multi-tier.**

**Rationale:** The Sheets API exposes no change token, revision counter, or per-range revision. It
does support HTTP conditional requests: send the prior ETag as `If-None-Match` and an unchanged
sheet returns 304 with no body. Combined with a TTL, a 30-second poll becomes a header-only round
trip that still counts as one quota unit. Serve the cached snapshot on 304; on fetch error, serve
stale and flag it.

**Cost of a full read:** one request, one quota unit, roughly 30–60 KB of JSON for 100 rows × 10
columns, single-digit milliseconds server-side. There is no scenario where avoiding a full read is
load-bearing.

**Cheap change detection, if ever needed:** Drive `files.get?fields=modifiedTime` gives a timestamp
at roughly the same quota cost, but it moves on formatting and formula recalculation, so it
over-triggers and is not a true content revision. A `developerMetadata` key bumped by n8n would be
a real content marker but would miss manual HR edits. Not worth it — the poll is already cheap.

**Alternatives rejected:** n8n static data — survives no redeploy and gives no shared view. Polling
Drive `modifiedTime` every 15s — extra quota, false positives, and it misses nothing we care about.

---

## 13. Audit logging without a database

**Decision: append-only audit tab in a **separate** spreadsheet, written server-side from n8n, plus
structured JSON application logs as a secondary copy.**

**Rationale:** A log aggregator answers "what happened" but not "who was given which information,"
because field-level disclosure fidelity is lost to sampling and retention. A separate sheet is
queryable, visible to HR, survives infrastructure replacement, and costs no new service.

Schema: `timestamp_utc`, `actor_email`, `action` (`view` / `list` / `advance_stage` / `export`),
`emp_id`, `fields_disclosed`, `request_id`.

Write the audit row **before** returning employee data. If the audit write fails, fail the read
rather than serve unlogged PII. Never write audit rows into the ingest range.

Write cost is trivial (60/min/user, one row per event) and there is no daily cap.

**Alternatives considered:** structured logs alone — retained longer and easier to alert on, but
weaker as the primary evidence store. A dedicated database — explicitly out of scope and
unjustified at this scale.

---

## 14. Concurrency and lost updates

**Decision: single-instance in-memory mutex keyed by `emp_id`, plus a monotonic stage guard. No
versioning column, no distributed locks, no CRDT.**

**Rationale:** Realistic failure modes are lost update (two admins both read stage `Orientation`,
both write, second silently wins), row drift (a row inserted or sorted between read and write
targets the wrong employee), and duplicate advancement. Mitigations in order of value:

1. **Monotonic guard** — stage is an ordered enum; reject or no-op any write to a stage at or below
   the current one. This makes double-advance idempotent and makes regression impossible, which
   handles exactly the scenario named in the brief.
2. **In-memory mutex with TTL** in the n8n code node, serializing read-modify-write per id within
   the instance. Sufficient because all writes already funnel through n8n.
3. **Row-target safety** — locate the row by scanning a freshly-read snapshot for `temp_emp_id`,
   never by a remembered row index, and re-verify the id immediately before writing.

**On optimistic concurrency:** the Sheets API's `values.update` does not honor `If-Match`
preconditions the way Drive resources do, so true compare-and-swap is not reliably available. A
`version` column plus read-check-write would be the workaround — real engineering cost against a
failure mode (two admins colliding inside the same 100ms window) whose worst outcome is one
redundant, monotonic-guarded, idempotent write.

**Scale override:** at tens-to-low-hundreds of employees with a single write path,
mutex-plus-monotonic-guard is the entire correct answer. Build versioning only if concurrent-edit
complaints appear in practice.

---

## 15. Explicit small-scale overrides

Enterprise defaults **rejected** for this project:

| Default | Decision | Reason |
|---|---|---|
| Redis | In-memory + framework cache | ~60 rows; Redis is unjustified |
| Background job runner / queue | None | Nothing needs async processing |
| Table virtualization | None | 60 rows renders instantly |
| Auth vendor (Auth0/Okta SDK) | Signed session cookie + role claim | RBAC as a switch, not a policy engine |
| Observability stack | Structured logs + `/api/health` | Probes both webhooks; no metrics infra |
| Storybook | Single `/design-system` route | Imports every component in all five states; tests the same invariants |
| Multi-browser matrix | Chromium only | Internal tool |
| MSW handler layer | Plain fixtures + Playwright route mocks | One cache, one page shape |
| Feature-flag service | Constant in `lib/flags.ts` | One flag |
| Micro-frontends | None | Single team, single deployable |

**The one place not to economize:** the BFF's credential handling and per-request authorization.
That is the entire security surface. Everything above is convenience.

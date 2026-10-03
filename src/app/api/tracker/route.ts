import { NextResponse } from "next/server";
import { getRoster } from "@/lib/sheets/cache";
import { ingestRoster } from "@/lib/sheets/ingest";
import { fetchProgress, mapWithConcurrency } from "@/lib/n8n/client";
import { classifyProgress, classifyUpstreamError } from "@/lib/n8n/classify";
import { PROGRESS_FANOUT_ENABLED, PROGRESS_READ_DISABLED } from "@/lib/n8n/safety";
import { AuthorizationError, assertModuleAccess, canViewEmployee, getSession } from "@/lib/auth/session";
import { listAuditEvent, writeAuditEvent } from "@/lib/audit/writer";
import { serializeEmployee } from "@/lib/serializer/employee";
import { toDisplayStage } from "@/lib/stages";
import type { RowResult } from "@/types/domain";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const CONCURRENCY = Number(process.env.TRACKER_FANOUT_CONCURRENCY ?? "6");
const ROW_TIMEOUT_MS = Number(process.env.TRACKER_ROW_TIMEOUT_MS ?? "10000");

/**
 * GET /api/tracker — the fan-out aggregator.
 *
 * onboarding-progress has NO list mode: it requires a temp_emp_id, so a view of
 * N employees is N upstream calls. This route collapses them into ONE browser
 * request and makes partial failure a VALUE in the response rather than an
 * exception.
 *
 * The build uses `Promise.allSettled` semantics (via mapWithConcurrency):
 * `Promise.all` would blank the entire table when a single employee fails,
 * which is precisely what FR-021 forbids.
 *
 * Each row is independently one of three states, because upstream returns
 * `success`, `not_found`, AND `error` all as HTTP 200.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "authentication required" } },
      { status: 401 },
    );
  }

  try {
    assertModuleAccess(session, "tracker");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  const requestId = randomUUID();

  let roster: Awaited<ReturnType<typeof getRoster>>;
  try {
    roster = await getRoster();
  } catch (cause) {
    // No cache AND no upstream: we cannot serve employee data at all.
    return NextResponse.json(
      {
        error: {
          code: "ROSTER_UNAVAILABLE",
          message: "Employee roster is unreachable and no cached copy is available.",
          details: cause instanceof Error ? cause.message : String(cause),
        },
      },
      { status: 502 },
    );
  }

  const { employees: ingested, quarantined, filteredPlaceholders } = ingestRoster(roster.result.rows);

  /*
   * FR-023 scope filter.
   *
   * Module access is not record access. `new_hire` and `manager` are permitted
   * onto the tracker MODULE, but without this filter the fan-out would return
   * EVERY employee — name, role, cohort, email, start date — to a user allowed
   * to see one row. The filter runs on the server, after ingest and before the
   * audit write, so a record outside the user's scope is never disclosed and
   * never logged as disclosed.
   */
  const employees = ingested.filter((employee) => canViewEmployee(session, employee.id, session.selfId));

  // Audit BEFORE returning employee data. If this fails the request fails —
  // unlogged PII is never served (FR-025).
  try {
    await writeAuditEvent(listAuditEvent(session.email, requestId));
  } catch (cause) {
    return NextResponse.json(
      {
        error: {
          code: "AUDIT_UNAVAILABLE",
          message: "Audit logging is unavailable; employee data is not being disclosed.",
          details: cause instanceof Error ? cause.message : String(cause),
        },
      },
      { status: 503 },
    );
  }

  /*
   * SAFETY KILL SWITCH — see src/lib/n8n/safety.ts for the full rationale.
   * `fetchProgress` POSTs `{ temp_emp_id }` with no `onboarding_stage`, which
   * makes the upstream workflow write an empty string to the sheet's
   * `onboarding_stage` column. Because the UI polls every 30s, running this
   * fan-out is a CONTINUOUS wipe of the SSOT and would undo any recovery from
   * version history.
   *
   * Rows fall back to sheet-derived data with `state: "error"`, which the UI
   * already renders as a partial failure (FR-021). The employee block still
   * discloses what the sheet knows.
   */
  const settled = await mapWithConcurrency(employees, CONCURRENCY, async (row) => {
    if (!PROGRESS_FANOUT_ENABLED) {
      return {
        id: row.id,
        state: "error" as const,
        message: PROGRESS_READ_DISABLED,
      };
    }
    const response = await fetchProgress(row.id);
    if (!response.ok && response.httpStatus >= 400) {
      return classifyUpstreamError(row.id, response.httpStatus);
    }
    return classifyProgress(row.id, response.body);
  });

  const rows: Array<RowResult & { employee: ReturnType<typeof serializeEmployee> }> = settled.map(
    (result, index) => {
      // `employees` is EmployeeRow[] (from ingestRoster), which carries the raw
      // sheet `stage` label and `welcomeStatus`.
      //
      // `settled[index]` and `employees[index]` are correlated by construction —
      // mapWithConcurrency writes results[index] from a monotonic cursor — so
      // this cannot be out of range while that holds. It is checked rather than
      // cast, because a cast here would silently attribute one employee's PII
      // to another if that invariant were ever broken.
      const employee = employees[index];
      if (!employee) {
        return {
          id: "",
          state: "error" as const,
          message: "roster row missing for this progress result",
          employee: serializeEmployee({
            id: "",
            name: "",
            role: null,
            startDate: null,
            cohort: null,
            email: null,
            totalEssentials: null,
            stage: null,
            stageStatus: null,
          }),
        };
      }
      const serialized = serializeEmployee({
        id: employee.id,
        name: employee.name ?? "",
        role: employee.role ?? null,
        startDate: employee.startDate ?? null,
        cohort: employee.cohort ?? null,
        email: employee.email ?? null,
        totalEssentials: employee.totalEssentials ?? null,
        // Sheet `onboarding_stage` holds coarse labels ("Not Started") that do
        // not match the fine-grained STAGES enum, so it is resolved for DISPLAY
        // only. The stage-update guard in POST /api/tracker/[id]/stage still
        // uses STAGES ordering and is unaffected by this mapping.
        stage: toDisplayStage(employee.stage),
        // `stageStatus` is welcome-EMAIL state, which ingest exposes as
        // `welcomeStatus`. Reading `employee.stageStatus` here always yielded
        // null: ingest maps welcome_status -> welcomeStatus and never produces
        // a `stageStatus` field, so every row reported an unknown status.
        stageStatus: employee.welcomeStatus ?? null,
      });

      // A rejected promise means the worker threw — turn it into a row-level
      // error rather than letting it propagate as a 500.
      const base: RowResult =
        result.status === "fulfilled"
          ? result.value
          : {
              id: employee.id,
              state: "error",
              message:
                result.reason instanceof Error ? result.reason.message : "progress request failed",
            };

      return { ...base, employee: serialized };
    },
  );

  return NextResponse.json({
    rows,
    /*
     * Surfaced so the UI can say WHY progress is empty instead of rendering a
     * confident "0% complete". With the fan-out off, every row is `error` and a
     * dashboard computing an average over zero successful rows shows 0% —
     * indistinguishable from "nobody has started".
     */
    progressFanoutEnabled: PROGRESS_FANOUT_ENABLED,
    rosterFreshness: {
      fetchedAt: roster.fetchedAt,
      ageSeconds: roster.ageSeconds,
      source: roster.source,
    },
    quarantined: {
      count: quarantined.length + filteredPlaceholders.length,
      rowNumbers: [...quarantined, ...filteredPlaceholders].map((q) => q.rowNumber),
    },
    generatedAt: new Date().toISOString(),
    rowTimeoutMs: ROW_TIMEOUT_MS,
  });
}
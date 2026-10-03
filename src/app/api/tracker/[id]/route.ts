import { NextResponse } from "next/server";
import { getRoster } from "@/lib/sheets/cache";
import { ingestRoster } from "@/lib/sheets/ingest";
import { fetchProgress } from "@/lib/n8n/client";
import { classifyProgress, classifyUpstreamError } from "@/lib/n8n/classify";
import { PROGRESS_FANOUT_ENABLED, PROGRESS_READ_DISABLED } from "@/lib/n8n/safety";
import {
  AuthorizationError,
  assertEmployeeAccess,
  assertModuleAccess,
  getSession,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit/writer";
import { serializeEmployee } from "@/lib/serializer/employee";
import { toDisplayStage } from "@/lib/stages";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

function error(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * GET /api/tracker/[id] — single-employee hydration.
 *
 * A single employee's upstream failure is a ROW-LEVEL error inside the payload,
 * not a 502: one person's data being unavailable must not look like the whole
 * endpoint being down.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession();
  if (!session) return error("UNAUTHENTICATED", "authentication required", 401);

  try {
    assertModuleAccess(session, "tracker");
    // selfId must be passed, or a new_hire can never read their OWN record —
    // canViewEmployee can then only refuse.
    assertEmployeeAccess(session, id, session.selfId);
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return error("FORBIDDEN", cause.message, cause.status);
    }
    throw cause;
  }

  let roster: Awaited<ReturnType<typeof getRoster>>;
  try {
    roster = await getRoster();
  } catch {
    return error("ROSTER_UNAVAILABLE", "Roster unreachable and no cached copy is available.", 502);
  }

  const { employees } = ingestRoster(roster.result.rows);
  const row = employees.find((e) => e.id === id);
  if (!row) return error("NOT_FOUND", "No such employee in the roster.", 404);

  // Audit BEFORE disclosing employee data (FR-025).
  await writeAuditEvent({
    actorEmail: session.email,
    action: "view",
    employeeId: id,
    fieldsDisclosed: ["id", "name", "role", "startDate", "cohort", "email", "stage", "stageStatus"],
    requestId: randomUUID(),
  });

  // KILL SWITCH: `fetchProgress` was destructive to the sheet's `onboarding_stage`
  // column — the workflow's update node wrote "" on any read that omitted the
  // field, so this route erased column I on every page view. That is fixed and
  // verified (src/lib/n8n/safety.ts); the flag remains so a workflow regression
  // can be contained without a deploy. The employee block below is served from
  // the sheet either way, so the page still renders while disabled.
  const progress = PROGRESS_FANOUT_ENABLED
    ? await (async () => {
        const response = await fetchProgress(id);
        return !response.ok && response.httpStatus >= 400
          ? classifyUpstreamError(id, response.httpStatus)
          : classifyProgress(id, response.body);
      })()
    : { id, state: "error" as const, message: PROGRESS_READ_DISABLED };

  return NextResponse.json({
    employee: serializeEmployee({
      id: row.id,
      name: row.name ?? "",
      role: row.role ?? null,
      startDate: row.startDate ?? null,
      cohort: row.cohort ?? null,
      email: row.email ?? null,
      totalEssentials: row.totalEssentials ?? null,
      // Same mapping as GET /api/tracker: the sheet's `onboarding_stage` holds
      // coarse labels that do not match the fine-grained STAGES enum, so it is
      // resolved for DISPLAY only. Previously this route cast the raw label
      // `as Stage` — an unchecked lie — and read `stageStatus`, which ingest
      // never populates, so it always returned null. The list and detail routes
      // disagreed about the same employee.
      stage: toDisplayStage(row.stage),
      stageStatus: row.welcomeStatus ?? null,
    }),
    progress,
    freshness: {
      fetchedAt: roster.fetchedAt,
      ageSeconds: roster.ageSeconds,
      source: roster.source,
    },
  });
}
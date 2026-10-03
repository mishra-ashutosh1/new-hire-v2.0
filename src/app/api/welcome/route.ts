import { NextResponse } from "next/server";
import { getRoster } from "@/lib/sheets/cache";
import { ingestRoster } from "@/lib/sheets/ingest";
import { AuthorizationError, assertModuleAccess, getSession } from "@/lib/auth/session";
import { listAuditEvent, writeAuditEvent } from "@/lib/audit/writer";
import { serializeEmployee } from "@/lib/serializer/employee";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/welcome
 *
 * Welcome status is sourced from the roster, not the webhook: the upstream
 * endpoint is PER-EMPLOYEE only and has no list mode, so statuses hydrate per
 * row on demand via POST /api/welcome/[id]. This route returns the roster plus
 * whatever status the sheet already records, so the table renders immediately.
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
    assertModuleAccess(session, "welcome");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  let roster: Awaited<ReturnType<typeof getRoster>>;
  try {
    roster = await getRoster();
  } catch {
    return NextResponse.json(
      { error: { code: "ROSTER_UNAVAILABLE", message: "Roster is unreachable.", details: undefined } },
      { status: 502 },
    );
  }

  const { employees, quarantined, filteredPlaceholders } = ingestRoster(roster.result.rows);

  await writeAuditEvent(listAuditEvent(session.email, randomUUID()));

  return NextResponse.json({
    rows: employees.map((employee) => ({
      employee: serializeEmployee({
        id: employee.id,
        name: employee.name ?? "",
        role: employee.role ?? null,
        startDate: employee.startDate ?? null,
        cohort: employee.cohort ?? null,
        email: employee.email ?? null,
        totalEssentials: employee.totalEssentials ?? null,
        stage: null,
        stageStatus: employee.stageStatus ?? null,
      }),
      // The sheet's welcome_status column records welcome-EMAIL state
      // ("welcome_sent"). Distinct from the onboarding stage/status the
      // webhook owns.
      recordedStatus: employee.welcomeStatus ?? null,
    })),
    freshness: {
      fetchedAt: roster.fetchedAt,
      ageSeconds: roster.ageSeconds,
      source: roster.source,
    },
    quarantinedCount: quarantined.length + filteredPlaceholders.length,
  });
}
import { NextResponse } from "next/server";
import { fetchProgress, updateProgressStage } from "@/lib/n8n/client";
import { classifyProgress } from "@/lib/n8n/classify";
import { PROGRESS_FANOUT_ENABLED } from "@/lib/n8n/safety";
import { getRoster } from "@/lib/sheets/cache";
import { ingestRoster } from "@/lib/sheets/ingest";
import { resolveStage } from "@/lib/stages";
import { stageUpdateSchema } from "@/lib/contracts/schemas";
import {
  AuthorizationError,
  assertEmployeeAccess,
  assertModuleAccess,
  getSession,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit/writer";
import { STAGES, stageOrder, type RowResult, type Stage } from "@/types/domain";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

function error(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * POST /api/tracker/[id]/stage — advance onboarding stage.
 *
 * MONOTONIC GUARD: a stage is an ordered enum and a transition must strictly
 * advance. Rejecting `to <= from` with 409 makes double-advance idempotent and
 * makes stage regression impossible — which is exactly what protects the named
 * scenario of two HR admins advancing the same employee at once.
 *
 * The Sheets API does not honor `If-Match`, so true compare-and-swap is not
 * available. Guard + write is the correct protection at this scale; a version
 * column would cost real engineering against a failure whose worst outcome is
 * one redundant, guarded, idempotent write.
 *
 * The pre-write stage is read from the SHEET, not from the webhook. It was
 * originally a webhook read, which made this guard self-defeating: the
 * onboarding-progress webhook erased the `onboarding_stage` column on read
 * (src/lib/n8n/safety.ts), so the guard checked an already-destroyed value,
 * skipped the `to <= from` comparison entirely, and the post-write refetch then
 * deleted the stage the write had just set. The sheet is the SSOT and was
 * always the correct source, so the read moved there permanently rather than
 * being switched back once the webhook was fixed.
 *
 * FR-010 asks for an authoritative payload rather than an optimistic
 * construction. With `TRACKER_PROGRESS_FANOUT=true` (the default in a configured
 * environment since 2026-10-03) that refetch is performed and is non-destructive,
 * so FR-010 is satisfied as written. While the kill switch is off the refetch is
 * skipped — it is the very operation being refused — and the response is composed
 * from the sheet value and the accepted stage instead.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession();
  if (!session) return error("UNAUTHENTICATED", "authentication required", 401);

  try {
    assertModuleAccess(session, "tracker");
    /*
     * Deliberately WITHOUT session.selfId.
     *
     * Passing selfId here would let a new hire advance their OWN onboarding
     * stage — they could mark themselves hired and onboarded. Stage transitions
     * are an HR action; a new hire is limited to reading their record. If the
     * signature of this check ever gains a selfId argument, that grant must be
     * revisited deliberately.
     */
    assertEmployeeAccess(session, id);
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return error("FORBIDDEN", cause.message, cause.status);
    }
    throw cause;
  }

  // The sheet is the SSOT and is the source of the pre-write stage used by the
  // monotonic guard. Loading it here is also what makes a nonexistent employee a
  // clean 404 instead of an upstream round-trip.
  let row;
  try {
    const roster = await getRoster();
    const { employees } = ingestRoster(roster.result.rows);
    row = employees.find((employee) => employee.id === id);
  } catch (cause) {
    return error(
      "ROSTER_UNAVAILABLE",
      "Employee roster is unreachable and no cached copy is available.",
      502,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (!row) return error("NOT_FOUND", "No such employee in the roster.", 404);

  const body = await request.json().catch(() => null);
  const parsed = stageUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      "INVALID_STAGE",
      "Unknown stage value.",
      400,
      parsed.error.issues.map((i) => i.message),
    );
  }

  /*
   * The monotonic check reads the SHEET, not the webhook.
   *
   * Previously this called `fetchProgress(id)` for `before` state and again for
   * `after`. Both were destructive: the upstream workflow writes an empty string
   * to `onboarding_stage` on any read that omits the field (src/lib/n8n/safety.ts).
   * The consequence was not just data loss — the pre-read ERASED the value the
   * monotonic guard was about to check, so `currentStage` came back null, the
   * `to <= from` comparison was skipped entirely, and the post-write refetch
   * then wiped the stage the write had just set. Stage updates could not work.
   *
   * The sheet is the SSOT, so it is the correct source for the guard anyway.
   */
  const currentStage = resolveStage(row.stage);
  const previousRaw = row.stage ?? null;

  if (currentStage) {
    const from = stageOrder(currentStage);
    const to = stageOrder(parsed.data.stage);
    // Strictly-greater rejects both regression and duplicate advancement.
    if (to <= from) {
      return error(
        "NON_MONOTONIC_STAGE",
        `Stage cannot move from "${currentStage}" to "${parsed.data.stage}". Transitions must advance.`,
        409,
      );
    }
  } else if (previousRaw && !PROGRESS_FANOUT_ENABLED) {
    // The sheet holds a coarse label with no canonical equivalent ("In Progress"
    // spans four fine-grained stages). We cannot rank it, and we deliberately do
    // not guess — but silently accepting the write would mean the monotonic
    // guard is not enforced at all.
    return error(
      "STAGE_UNRANKABLE",
      `Current stage "${previousRaw}" is not in the ordered vocabulary, so advancement cannot be verified.`,
      409,
    );
  }

  await writeAuditEvent({
    actorEmail: session.email,
    action: "advance_stage",
    employeeId: id,
    fieldsDisclosed: ["stage"],
    requestId: randomUUID(),
  });

  const write = await updateProgressStage(id, parsed.data.stage);
  if (!write.ok && write.httpStatus >= 400) {
    return error("UPSTREAM_WRITE_FAILED", `Stage update failed with HTTP ${write.httpStatus}`, 502);
  }

  // The post-write refetch is now safe. `fetchProgress` used to be destructive —
  // the workflow wrote "" to `onboarding_stage` on any read that omitted the
  // field, which deleted the very stage this handler had just written. That is
  // fixed and verified (src/lib/n8n/safety.ts), so with the kill switch on this
  // is an ordinary, non-destructive read and it is what makes the FR-010
  // authoritative refetch possible. It stays skipped while the switch is off,
  // because then the read is exactly the operation we are refusing to perform.
  const progress = PROGRESS_FANOUT_ENABLED
    ? await (async () => {
        const after = await fetchProgress(id);
        return after.ok && after.httpStatus < 400
          ? classifyProgress(id, after.body)
          : { id, state: "error" as const, message: `refetch failed with HTTP ${after.httpStatus}` };
      })()
    : ({
        id,
        state: "success",
        data: {
          tempEmpId: id,
          name: row.name ?? null,
          role: row.role ?? null,
          stage: parsed.data.stage,
          stageStatus: row.welcomeStatus ?? null,
          percentComplete: 0,
          completedCount: 0,
          totalItems: row.totalEssentials ?? 0,
          completed: [],
          outstanding: [],
          // null, not "none": this payload is composed without calling the
          // webhook (the kill switch is off), so the upstream's opinion about
          // whether a checklist exists was never obtained. Claiming "none" would
          // assert missing data we did not actually check for.
          checklistSource: null,
          canUpdateStage: true,
          requestedStageUpdate: false,
        },
      } satisfies RowResult);

  return NextResponse.json({
    progress,
    previousStage: currentStage,
    requestedStage: parsed.data.stage as Stage,
    validStages: STAGES,
  });
}
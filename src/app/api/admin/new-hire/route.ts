import { NextResponse } from "next/server";
import { createNewHire } from "@/lib/n8n/client";
import { classifyAdmin } from "@/lib/n8n/classify";
import { adminRequestSchema } from "@/lib/contracts/schemas";
import {
  AuthorizationError,
  assertModuleAccess,
  getSession,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit/writer";
import { POC_ACTOR_EMAIL, POC_MODE_ENABLED } from "@/lib/auth/poc";
import { DEMO_MODE } from "@/lib/demo";
import { addDemoEmployee } from "@/lib/demo/roster";
import { invalidateRoster } from "@/lib/sheets/cache";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/new-hire
 *
 * CONTRACT VERIFIED 2026-10-02 against the exported `Admin` n8n workflow.
 * The gate below is now a deployment switch rather than a safety rail: set
 * ADMIN_CONTRACT_VERIFIED=true once you have enabled it in the environment.
 *
 * Verified behaviour:
 *   created   -> HTTP 201 `{ status:"ok", temp_emp_id, name, emailID, onboarding_status }`
 *   duplicate -> HTTP 200 `{ status:"already_processed", ... }` — NOTHING is written
 *   invalid   -> HTTP 400 `{ status:"error", message, errors[] }`
 *
 * `temp_emp_id` is REQUIRED FROM THE CLIENT and `totalEssentials` is copied from
 * the request when present. An earlier version of this docblock claimed both were
 * workflow-generated and MUST NOT be client-supplied; `Validate New Hire1` errors
 * with `temp_emp_id is required` when it is absent, so that claim would have 400'd
 * every real provisioning call.
 *
 * The flag is still off by default and should stay off until it is deliberately
 * enabled: this endpoint creates real employee records with no undo. The UI now
 * exists and collects every required field (`src/app/new-hire/page.tsx`), and
 * `NEW_HIRE_DRY_RUN=true` exercises it end to end without touching live data —
 * so the remaining reason to leave the flag off is deployment caution, not a
 * missing form.
 */

/** In-flight mutex keyed by client request id (FR-014). */
const inflight = new Map<string, { startedAt: number }>();
const INFLIGHT_TTL_MS = 60_000;

function isDuplicateSubmission(requestId: string): boolean {
  const now = Date.now();
  for (const [key, value] of inflight) {
    if (now - value.startedAt > INFLIGHT_TTL_MS) inflight.delete(key);
  }
  if (inflight.has(requestId)) return true;
  inflight.set(requestId, { startedAt: now });
  return false;
}

export async function POST(request: Request) {
  const session = await getSession();

  // POC_MODE skips ONLY the identity check. Validation, the duplicate guard, the
  // feature flag and the dry run all still apply below.
  if (!POC_MODE_ENABLED) {
    if (!session) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "authentication required" } },
        { status: 401 },
      );
    }

    try {
      assertModuleAccess(session, "new-hire");
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: error.message } },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  // Gated until the contract is verified against the workflow.
  if (process.env.ADMIN_CONTRACT_VERIFIED !== "true") {
    return NextResponse.json(
      {
        error: {
code: "CONTRACT_UNVERIFIED",
        message:
          "New-hire provisioning is disabled by flag. " +
          "The contract was confirmed against the workflow on 2026-10-02, but this endpoint " +
          "creates real employee records with no dry run and its workflow sends a real welcome " +
          "email, so it stays off until it is deliberately enabled.",
        },
      },
      { status: 503 },
    );
  }

  // Deduplication key supplied by the client form; a repeated submit with the
  // same key is refused rather than creating a second employee.
  const requestId = request.headers.get("X-Request-Id") ?? randomUUID();
  if (isDuplicateSubmission(requestId)) {
    return NextResponse.json(
      {
        error: {
          code: "DUPLICATE_SUBMISSION",
          message: "This submission is already being processed. No additional record was created.",
        },
      },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = adminRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Correct the highlighted fields and try again.",
          // Field-keyed so the form can attach each problem to its input.
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  // Field names confirmed against `Validate New Hire1` in the live Admin
  // workflow (2026-10-02). That node REQUIRES `temp_emp_id` from the caller and
  // only errors on that, `name`, `role` and `emailID`.
  //
  // Optional keys are OMITTED rather than sent as `null`. `pick()` treats
  // undefined and null identically, so both behave the same today — but sending
  // a key the caller does not actually have is never the safer choice against an
  // unknown downstream guard.
  //
  // `completed_essentials` is deliberately NOT sent: sheet column H is a formula
  // derived from the chips in column I.
  const wire: Record<string, unknown> = {
    temp_emp_id: parsed.data.tempEmpId,
    name: parsed.data.name,
    role: parsed.data.role,
    emailID: parsed.data.email,
  };
  if (parsed.data.startDate) wire.start_date = parsed.data.startDate;
  if (parsed.data.cohort) wire.cohort = parsed.data.cohort;
  if (parsed.data.totalEssentials !== null && parsed.data.totalEssentials !== undefined) {
    wire.total_essentials = parsed.data.totalEssentials;
  }
  if (parsed.data.onboardingStage) wire.onboarding_stage = parsed.data.onboardingStage;

  // Dry run (T065). Placed AFTER validation and the duplicate claim, so it
  // exercises the real gate and the real wire mapping, but stops short of the
  // audit write and the workflow call — the two things that touch live data.
  //
  // This is what makes the form safe to try. Without it, the only way to see
  // whether the page works is to create a real employee and email a real
  // stranger, which is why this feature sat unfinished: there was no way to
  // test it that did not mean doing the irreversible thing.
  if (process.env.NEW_HIRE_DRY_RUN === "true") {
    return NextResponse.json(
      {
        id: parsed.data.tempEmpId,
        created: false,
        dryRun: true,
        message:
          "Dry run: the request was validated and mapped, but nothing was written and no welcome email was sent.",
        // Echoed so the mapping can be eyeballed against the workflow contract.
        wire,
      },
      { status: 200 },
    );
  }

  await writeAuditEvent({
    actorEmail: session?.email ?? POC_ACTOR_EMAIL,
    action: "create",
    employeeId: "*",
    fieldsDisclosed: [],
    requestId,
  });

  const response = await createNewHire(wire);

  if (!response.ok && response.httpStatus >= 400) {
    return NextResponse.json(
      {
        error: {
          code: "PROVISIONING_FAILED",
          message: `The provisioning workflow rejected this request (HTTP ${response.httpStatus}).`,
          details: response.body,
        },
      },
      { status: 502 },
    );
  }

  const classified = classifyAdmin(response.body);

  // Demo mode: the "write" is a line in this process's memory. Recorded here
  // rather than upstream so the tracker shows the new hire for the rest of the
  // demo session, and cleared from the roster cache so it appears immediately.
  if (DEMO_MODE && classified.outcome === "created" && classified.tempEmpId) {
    addDemoEmployee({
      temp_emp_id: classified.tempEmpId,
      name: wire.name as string,
      role: wire.role as string,
      emailID: wire.emailID as string,
      ...(wire.start_date ? { start_date: wire.start_date as string } : {}),
      ...(wire.cohort ? { cohort: wire.cohort as string } : {}),
      ...(wire.total_essentials !== undefined
        ? { total_essentials: String(wire.total_essentials) }
        : {}),
      // `welcome_status` stays empty: the real workflow writes `welcome_sent`
      // after emailing someone, and in demo mode nobody was emailed.
    });
    invalidateRoster();
  }

  if (classified.outcome === "rejected") {
    return NextResponse.json(
      {
        error: {
          code: "PROVISIONING_REJECTED",
          message: classified.message,
          // Field-level reasons from the workflow, so the form can show them
          // rather than a generic failure.
          details: classified.errors,
        },
      },
      { status: 502 },
    );
  }

  if (classified.outcome === "already_exists") {
    // HTTP 200 but NOTHING was written. Reporting 201 here would tell HR a new
    // hire exists when the sheet is unchanged.
    return NextResponse.json(
      {
        id: classified.tempEmpId,
        created: false,
        message: classified.message,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      id: classified.tempEmpId,
      created: true,
      // Demo mode writes to this process's memory only. The UI says so rather
      // than reporting a hire that does not exist anywhere else.
      demo: DEMO_MODE,
      message: DEMO_MODE
        ? `Demo hire ${classified.tempEmpId ?? ""} added to the in-memory roster. No email was sent and no sheet was written.`.trim()
        : `New hire record created${classified.tempEmpId ? ` with identifier ${classified.tempEmpId}` : ""}.`,
    },
    { status: 201 },
  );
}
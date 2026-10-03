import { NextResponse } from "next/server";
import { sendWelcome } from "@/lib/n8n/client";
import { classifyWelcome } from "@/lib/n8n/classify";
import {
  AuthorizationError,
  assertEmployeeAccess,
  assertModuleAccess,
  getSession,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit/writer";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/welcome/[id]
 *
 * `already_sent` is HTTP 200 idempotent SUCCESS, not an error — it is the
 * expected steady state, and `emailSent: false` there means "no new send
 * occurred", never "the send failed" (FR-017).
 *
 * The upstream returns HTTP 500 for unknown or malformed ids. That maps to 502
 * here with the id ECHOED, so the affected employee is identifiable rather than
 * leaving the operator guessing which record failed (FR-018).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "authentication required" } },
      { status: 401 },
    );
  }

  try {
    assertModuleAccess(session, "welcome");
    assertEmployeeAccess(session, id, session.selfId);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  await writeAuditEvent({
    actorEmail: session.email,
    action: "create",
    employeeId: id,
    fieldsDisclosed: [],
    requestId: randomUUID(),
  });

  const response = await sendWelcome(id);

  // Echo the id on every failure path so the affected employee is identifiable.
  if (!response.ok && response.httpStatus >= 400) {
    return NextResponse.json(
      {
        error: {
          code: "WELCOME_UPSTREAM_FAILED",
          message: `Welcome sequence failed for employee ${id} (HTTP ${response.httpStatus}).`,
          employeeId: id,
        },
      },
      { status: 502 },
    );
  }

  const result = classifyWelcome(response.body);

  if (result.status === "error") {
    return NextResponse.json(
      {
        error: {
          code: "WELCOME_FAILED",
          message: result.message,
          employeeId: id,
        },
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ...result, employeeId: id });
}
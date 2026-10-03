import type { RowResult, Stage } from "@/types/domain";
import { STAGES } from "@/types/domain";
import { progressResponseSchema, welcomeResponseSchema, adminResponseSchema } from "@/lib/contracts/schemas";
import type { z } from "zod";

type ProgressPayload = z.infer<typeof progressResponseSchema>;
type WelcomePayload = z.infer<typeof welcomeResponseSchema>;
type AdminResponse = z.infer<typeof adminResponseSchema>;

/**
 * Response classifiers (T013).
 *
 * THE THREE-STATE TRAP: onboarding-progress returns `success`, `not_found`,
 * and `error` ALL as HTTP 200. Branching on the HTTP code renders them
 * identically, which sends HR to retry a lookup that can never succeed.
 * `not_found` additionally means the sheet and the workflow disagree — an
 * operations condition to surface (FR-011), not a user error.
 */

function toStage(value: string | null | undefined): Stage | null {
  if (!value) return null;
  return (STAGES as readonly string[]).includes(value) ? (value as Stage) : null;
}

/**
 * Map a raw onboarding-progress body to the discriminated union. Call this on
 * the BODY, never on the HTTP status.
 */
export function classifyProgress(id: string, body: unknown): RowResult {
  const parsed = progressResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { id, state: "error", message: "malformed progress response" };
  }
  const p = parsed.data as ProgressPayload;

  if (p.status === "not_found") {
    return {
      id,
      state: "not_found",
      message: p.message ?? "No onboarding record found for this employee.",
    };
  }
  if (p.status === "error") {
    return { id, state: "error", message: p.message ?? "progress request was rejected" };
  }

  return {
    id,
    state: "success",
    data: {
      tempEmpId: p.temp_emp_id ?? id,
      name: p.name ?? null,
      role: p.role ?? null,
      stage: toStage(p.onboarding_stage),
      stageStatus: p.onboarding_status ?? null,
      percentComplete: p.percent_complete ?? 0,
      completedCount: p.completed_count ?? 0,
      totalItems: p.total_items ?? 0,
      completed: p.completed ?? [],
      outstanding: p.outstanding ?? [],
      // Preserve the upstream's "I checked and there is no checklist" signal, which is
      // the only thing distinguishing an untracked employee from a finished one.
      //
      // The closed enum in `progressResponseSchema` already rejects an unknown
      // value outright (the row becomes `error`, which is the desired loud
      // failure on contract drift). This narrowing is belt-and-braces for the
      // `as ProgressPayload` cast above: it guarantees the UI can only ever see
      // the two documented values or `null`, never an arbitrary string.
      checklistSource:
        p.checklist_source === "onboarding_stage" || p.checklist_source === "none"
          ? p.checklist_source
          : null,
      canUpdateStage: p.can_update_stage ?? false,
      requestedStageUpdate: p.requested_stage_update ?? false,
    },
  };
}

export interface WelcomeClassification {
  status: "sent" | "already_sent" | "error";
  emailSent: boolean;
  message: string;
}

/**
 * Welcome classification. `already_sent` is idempotent SUCCESS, not an error —
 * it is the expected steady state, and `emailSent: false` there means "no new
 * send occurred", never "the send failed" (FR-017).
 */
export function classifyWelcome(body: unknown): WelcomeClassification {
  const parsed = welcomeResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { status: "error", emailSent: false, message: "malformed welcome response" };
  }
  const w = parsed.data as WelcomePayload;
  if (w.status === "sent") {
    return { status: "sent", emailSent: true, message: w.message ?? "Welcome email sent." };
  }
  if (w.status === "already_sent") {
    return {
      status: "already_sent",
      emailSent: false,
      message: w.message ?? "Welcome email has already been sent for this employee.",
    };
  }
  return { status: "error", emailSent: false, message: w.message ?? "Welcome send failed." };
}

/** Fallback message when an upstream HTTP error carries no body. */
export function classifyUpstreamError(id: string, httpStatus: number): RowResult {
  return {
    id,
    state: "error",
    message: `onboarding-progress request failed with HTTP ${httpStatus}`,
  };
}

export type AdminClassification =
  | { outcome: "created"; tempEmpId: string | null; name: string | null }
  | { outcome: "already_exists"; tempEmpId: string | null; name: string | null; message: string }
  | { outcome: "rejected"; errors: string[]; message: string };

/**
 * Admin webhook classification.
 *
 * The workflow's success token is `ok`, not `success` — treating them as the
 * same thing is the whole point of this function. `already_processed` is the
 * case that matters most: the workflow returns HTTP 200 having written NOTHING,
 * so a caller that reads only the HTTP code reports a hire created when no row
 * exists. It gets its own outcome rather than being folded into success.
 *
 * `onboarding_status` in the payload is accepted and ignored: it must never be
 * allowed to stand in for onboarding progress, which is derived from
 * `onboarding_stage`.
 */
export function classifyAdmin(body: unknown): AdminClassification {
  const parsed = adminResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      outcome: "rejected",
      errors: [],
      message: "malformed provisioning response",
    };
  }
  const a = parsed.data as AdminResponse;

  if (a.status === "ok" || a.status === "success") {
    return { outcome: "created", tempEmpId: a.temp_emp_id ?? null, name: a.name ?? null };
  }

  if (a.status === "already_processed") {
    return {
      outcome: "already_exists",
      tempEmpId: a.temp_emp_id ?? null,
      name: a.name ?? null,
      message:
        a.message ??
        "This employee already has a row in the sheet. No record was created and no welcome email was sent.",
    };
  }

  return {
    outcome: "rejected",
    errors: a.errors ?? [],
    message: a.message ?? "The provisioning workflow rejected this request.",
  };
}
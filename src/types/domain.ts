/**
 * Domain types (T009).
 *
 * The critical shape here is `RowResult`. The onboarding-progress webhook
 * returns `success`, `not_found`, and `error` ALL as HTTP 200, so branching on
 * the HTTP code renders them identically — which misdirects HR to retry a
 * lookup that can never succeed. Encoding the status as a discriminated union
 * with exactly three cases makes that mistake a compile error.
 */

/**
 * Ordered onboarding stage enum.
 *
 * The canonical vocabulary is still owned by the n8n workflow and is NOT
 * confirmed — three coarse vocabularies now exist in the live system: the
 * sheet's `Not Started` / `In Progress` / `Completed`, the Admin workflow's
 * `Day 0` default, and this fine-grained enum. They share no literal value.
 *
 * RESOLUTION (2026-10-02): the drift is handled as a mapping concern in the
 * BFF serializer (`src/lib/stages.ts`) rather than by redefining this enum.
 * `toDisplayStage` resolves the unambiguous labels for DISPLAY ONLY and renders
 * anything else verbatim. `STAGES` below is deliberately left untouched, so the
 * monotonic guard in POST /api/tracker/[id]/stage keeps its original ordering.
 * Confining the mapping to display is what makes this safe to ship while the
 * canonical vocabulary is still open.
 */
export const STAGES = [
  "not_started",
  "it_setup",
  "orientation",
  "meet_and_greet",
  "task_complete",
  "status_confirmed",
  "complete",
] as const;

export type Stage = (typeof STAGES)[number];

/** Ordinal position of a stage. Used by the monotonic guard. */
export function stageOrder(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export type Role = "hr_admin" | "manager" | "new_hire";

/** Progress payload as returned by the onboarding-progress webhook. */
export interface OnboardingProgress {
  tempEmpId: string;
  name: string | null;
  role: string | null;
  stage: Stage | null;
  stageStatus: string | null;
  percentComplete: number;
  completedCount: number;
  totalItems: number;
  completed: string[];
  outstanding: string[];
  /**
   * Whether the upstream had any per-item signal to report.
   *
   * `null` means the upstream did not say (older workflow, or the field was
   * absent), which is DIFFERENT from `"none"`, which means the upstream checked
   * and found the sheet holds no checklist for this employee.
   *
   * This distinction is load-bearing. With `"none"`, `completed` and `outstanding`
   * are BOTH empty — and "both empty" otherwise means "nothing left to do". A UI
   * that renders the empty case as "All items complete" tells a new hire they
   * are finished when in fact nothing is being tracked. Observed live
   * 2026-10-03 with the real employee: `checklist_source: "none"`,
   * `completed_count: 0`, `total_items: 3`, and both lists empty.
   */
  checklistSource: "onboarding_stage" | "none" | null;
  canUpdateStage: boolean;
  requestedStageUpdate: boolean;
}

/**
 * Discriminated union with NO fourth case. A caller cannot silently collapse
 * `not_found` into `error` because the compiler rejects the fourth variant.
 */
export type RowResult =
  | { id: string; state: "success"; data: OnboardingProgress }
  | { id: string; state: "not_found"; message: string }
  | { id: string; state: "error"; message: string };

/**
 * Employee as projected from the sheet. `id` is a trimmed STRING key and is
 * never coerced to a number — the sheet stores it as both text and number, and
 * every downstream webhook lookup keys on it.
 */
export interface Employee {
  id: string;
  name: string;
  role: string | null;
  startDate: string | null;
  /** Mixed type in the sheet. Blank becomes null — never 0, which would
   * collide with a real id. */
  cohort: string | null;
  email: string | null;
  totalEssentials: number | null;
  /**
   * The sheet's RAW `onboarding_stage` label, e.g. "Not Started".
   *
   * Typed as `Stage | null` for callers that compare against the ordered enum,
   * but ingest preserves the raw string verbatim (`toEmployeeRow` uses
   * `asText`), so a live value is usually NOT a `Stage` — the two vocabularies
   * share no literal value. Display code must run it through
   * `toDisplayStage`; code that compares stages must not assume it is one.
   *
   * Blank as of 2026-10-02: the column held chips earlier that day and was
   * emptied by the upstream progress workflow writing an empty string on read.
   */
  stage: Stage | null;
  stageStatus: string | null;
}

export interface QuarantinedRow {
  /** 1-indexed, matching the sheet, so HR can locate the row. */
  rowNumber: number;
  raw: Record<string, string>;
  issues: string[];
}

/** Data age. Always present on any response carrying employee data. */
export interface Freshness {
  fetchedAt: string;
  ageSeconds: number;
  source: "live" | "cache" | "stale";
}

/**
 * Policy response classification.
 *
 * `answered` requires BOTH a non-empty answer AND a non-empty source. The
 * upstream workflow can return `status: "success"` with an EMPTY answer, which
 * is the single most dangerous response shape in the system — a naive client
 * renders either a blank card or a skeleton that never resolves and reads as
 * "still loading". The BFF coerces that shape to `unanswered`.
 */
export interface PolicyResponse {
  status: "answered" | "unanswered" | "error";
  answer: string | null;
  source: string | null;
}

/**
 * `already_sent` is idempotent SUCCESS, not an error, and is the expected
 * steady state. `emailSent: false` there means "no new send occurred" — never
 * "the send failed".
 */
export type WelcomeResponse =
  | { status: "sent"; emailSent: true; message: string }
  | { status: "already_sent"; emailSent: false; message: string };

export interface HealthReport {
  status: "ok" | "degraded";
  /** `detail` is present only when unreachable, and carries the failure cause. */
  n8n: { reachable: boolean; checkedAt: string; detail?: string };
  /** `ageSeconds` is null when no roster has been cached yet — never negative. */
  sheet: { reachable: boolean; ageSeconds: number | null; checkedAt: string };
}
import { z } from "zod";
import { STAGES } from "@/types/domain";
import { asText, cell, cohortCell, emailCell, idCell, isoDateCell, numericCell } from "./preprocess";

/**
 * Shared contracts (T010).
 *
 * This module is imported by BOTH the browser and the Route Handlers. One
 * definition drives client validation and server-side revalidation, which is
 * how an unverified upstream contract gets contained: when the real field set
 * is confirmed, exactly one file changes.
 */

/**
 * One row of Sheet1. `completed_essentials` and `onboarding_stage` are optional
 * with defaults because they are EMPTY in every observed row — the workflow
 * computes progress independently and never persists it. Ingest must not fail
 * while that gap exists.
 *
 * `name`/`role`/`stage`/`stageStatus` use the permissive `cell` (unknown) because
 * a missing optional column must not fail validation. `EmployeeRow` below
 * narrows them to the shapes consumers actually receive.
 */
export const employeeRowSchema = z.object({
  id: idCell,
  name: cell,
  role: cell,
  startDate: isoDateCell,
  cohort: cohortCell,
  email: emailCell,
  totalEssentials: numericCell,
  completedEssentials: numericCell,
  stage: cell,
  stageStatus: cell,
  welcomeStatus: cell,
});

type RawEmployeeRow = z.output<typeof employeeRowSchema>;

/** Narrowed shape returned by ingest. Text fields are `string | null`. */
export interface EmployeeRow {
  id: string;
  name: string | null;
  role: string | null;
  startDate: string | null;
  cohort: string | null;
  email: string | null;
  totalEssentials: number | null;
  completedEssentials: number | null;
  /** Onboarding stage. Empty in the sheet today — the webhook is authoritative. */
  stage: string | null;
  /**
   * Onboarding status from the SHEET. Distinct from `welcomeStatus` below:
   * these are different facts written by different systems.
   */
  stageStatus: string | null;
  /**
   * Welcome-EMAIL state from the sheet's `welcome_status` column, e.g.
   * "welcome_sent". Feeds the welcome console's recorded-status column and is
   * deliberately NOT rendered as an onboarding stage.
   */
  welcomeStatus: string | null;
}

export function toEmployeeRow(raw: RawEmployeeRow): EmployeeRow {
  return {
    id: raw.id,
    name: asText(raw.name),
    role: asText(raw.role),
    startDate: raw.startDate,
    cohort: raw.cohort,
    email: raw.email ?? null,
    totalEssentials: raw.totalEssentials ?? null,
    completedEssentials: raw.completedEssentials ?? null,
    stage: asText(raw.stage),
    stageStatus: asText(raw.stageStatus),
    welcomeStatus: asText(raw.welcomeStatus),
  };
}

export type EmployeeRowInput = z.input<typeof employeeRowSchema>;

/**
 * Map a raw sheet row (keyed by the sheet's own column names) onto the
 * schema's field names. This translation is REQUIRED: the sheet uses
 * `temp_emp_id` / `start_date` / `emailID` while the domain model uses
 * `id` / `startDate` / `email`. Passing cells straight into the schema
 * matches nothing and quarantines every row.
 *
 * Unknown columns are DROPPED here rather than reaching the domain model —
 * the first half of the PII allowlist guarantee, since a new sheet column
 * cannot pass through by default.
 */
export const SHEET_COLUMN_MAP: Record<string, string> = {
  temp_emp_id: "id",
  name: "name",
  role: "role",
  start_date: "startDate",
  cohort: "cohort",
  emailID: "email",
  total_essentials: "totalEssentials",
  completed_essentials: "completedEssentials",
  onboarding_stage: "stage",
  // `welcome_status` holds welcome-EMAIL state (e.g. "welcome_sent"), which is a
  // different fact from onboarding progress. It is mapped to its own field so it
  // can never be rendered as an onboarding stage label.
  //
  // The Apps Script webhook writes onboarding progress to a SEPARATE column,
  // `onboarding_progress_status`. Do not merge the two: they answer different
  // questions and are updated by different writers.
  welcome_status: "welcomeStatus",
};

export function mapSheetRow(cells: Record<string, string>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [column, field] of Object.entries(SHEET_COLUMN_MAP)) {
    const value = cells[column];
    if (value !== undefined) mapped[field] = value;
  }
  return mapped;
}

/**
 * `name` is the one truly mandatory field beyond `id`. Kept separate from
 * employeeRowSchema so the quarantine rule can state a precise reason.
 */
export const namedEmployeeRowSchema = employeeRowSchema.refine(
  (row) => typeof row.name === "string" && row.name.length > 0,
  { message: "name is required", path: ["name"] },
);

/** Raw onboarding-progress webhook payload (observed 2026-10-02). */
export const progressResponseSchema = z.object({
  status: z.enum(["success", "not_found", "error"]),
  temp_emp_id: z.string().optional(),
  name: z.string().nullish(),
  role: z.string().nullish(),
  onboarding_stage: z.string().nullish(),
  onboarding_status: z.string().nullish(),
  percent_complete: z.number().optional(),
  completed_count: z.number().optional(),
  total_items: z.number().optional(),
  completed: z.array(z.string()).optional(),
  outstanding: z.array(z.string()).optional(),
  /**
   * Added by the fixed onboarding-progress workflow (2026-10-03).
   * `onboarding_stage` | `none` — distinguishes "the sheet recorded no chips"
   * from "the sheet has no per-item checklist to report". Lets the UI say which,
   * rather than rendering an empty OutstandingList that reads as "nothing
   * outstanding".
   */
  checklist_source: z.enum(["onboarding_stage", "none"]).optional(),
  /**
   * Welcome-EMAIL state. Deliberately separate from `onboarding_status`: one is
   * "the email went out", the other is onboarding progress. Conflating them
   * would tell HR a hire has onboarded when only their email was sent.
   */
  welcome_status: z.string().nullish(),
  can_update_stage: z.boolean().optional(),
  requested_stage_update: z.boolean().optional(),
  message: z.string().optional(),
});

/** Raw policy webhook payload. Note `answer` may be present AND empty. */
export const policyResponseSchema = z.object({
  status: z.enum(["success", "error"]).catch("success"),
  answer: z.string().nullish(),
  source: z.string().nullish(),
});

/** Raw welcome webhook payload. */
export const welcomeResponseSchema = z.object({
  status: z.enum(["sent", "already_sent", "error"]).catch("error"),
  message: z.string().optional(),
  email_sent: z.boolean().optional(),
});

/**
 * CONFIRMED against the live `Admin` workflow's `Validate New Hire1` node
 * (2026-10-02), read from the node source:
 *
 *   if (!record.temp_emp_id) errors.push('temp_emp_id is required');
 *   if (!record.name)        errors.push('name is required');
 *   if (!record.role)        errors.push('role is required');
 *   if (!record.emailID)     errors.push('emailID is required');
 *
 * This CORRECTS an earlier assumption recorded here. The schema previously
 * rejected a client-supplied `temp_emp_id` and `totalEssentials` on the belief
 * that both were workflow-generated, and required `startDate`. None of that
 * holds: `temp_emp_id` is required FROM THE CLIENT, `total_essentials` is
 * copied straight from the request when present, and only the four fields
 * above are actually required. Rejecting `temp_emp_id` guaranteed a 400 from
 * the workflow whenever this endpoint was enabled.
 *
 * The node also defaults `onboarding_stage` to `'Day 0'` and hardcodes
 * `onboarding_status: 'pending_welcome'`. Note `onboarding_status` is NOT a
 * column in `Sheet1` — the real column J header is `welcome_status` — so that
 * key is the workflow's own invention and must not be treated as sheet truth.
 *
 * `.strict()` still applies: an unrecognised key is an error, so a typo'd field
 * surfaces as a 400 instead of being silently dropped upstream.
 */
/**
 * An optional field that must tolerate a blank form input.
 *
 * `.nullish()` accepts `null` and `undefined` but NOT `""`, and an untouched
 * `<input>` or `<select>` in a React form posts `""`. Without this, a hire with
 * no cohort or no start date gets a 400 from the BFF even though the workflow
 * happily copies those fields through when present.
 */
const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullish());

const optionalCount = z.preprocess(
  (value) => (value === "" || (typeof value === "string" && value.trim() === "") ? null : value),
  z.number().int().nonnegative().nullish(),
);

export const adminRequestSchema = z
  .object({
    /** Wire name `temp_emp_id`. Required by the workflow — caller-assigned. */
    tempEmpId: z.string().trim().min(1, "temp_emp_id is required").max(40),
    name: z.string().trim().min(1, "name is required").max(120),
    role: z.string().trim().min(1, "role is required").max(120),
    email: z.string().email("invalid email format"),
    /** Optional upstream — the node copies it through when present. */
    startDate: optionalString(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start date must be YYYY-MM-DD")),
    cohort: optionalString(z.string().trim().min(1).max(40)),
    /** Optional upstream. NOT workflow-generated. */
    totalEssentials: optionalCount,
    /**
     * Accepted but NOT forwarded. Sheet column H is the formula
     * `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))` — it is derived from
     * the chips in column I, so a client-supplied number would either clobber
     * the formula or plant a hardcoded value that silently stops tracking the
     * moment column I changes.
     */
    completedEssentials: optionalCount,
    /** Optional; the workflow defaults it to 'Day 0' when absent. */
    onboardingStage: optionalString(z.string().trim().min(1).max(60)),
  })
  .strict();

export type AdminRequest = z.infer<typeof adminRequestSchema>;

/**
 * VERIFIED against the exported `Admin` workflow (2026-10-02). Read from the
 * three `respondToWebhook` branches:
 *
 *   created   -> 201 `{ status:"ok", temp_emp_id, name, emailID, onboarding_status }`
 *   duplicate -> 200 `{ status:"already_processed", message, ... }`  nothing written
 *   invalid   -> 400 `{ status:"error", message, errors[] }`
 *
 * Note the workflow's success token is `ok`, NOT `success`. `success` is
 * accepted too so a future edit to the workflow cannot silently turn a
 * successful hire into an unknown state.
 *
 * `onboarding_status` in the response is NOT authoritative and is deliberately
 * ignored: the sheet column is `welcome_status`, and an `onboarding_*` key must
 * never be allowed to masquerade as onboarding progress. It is declared here
 * only so the key is accepted and dropped rather than failing validation.
 */
export const adminResponseSchema = z.object({
  status: z.enum(["ok", "success", "already_processed", "error"]).catch("error"),
  temp_emp_id: z.string().nullish(),
  name: z.string().nullish(),
  emailID: z.string().nullish(),
  message: z.string().nullish(),
  errors: z.array(z.string()).nullish(),
  // Accepted and discarded — see above.
  onboarding_status: z.string().nullish(),
});

export type AdminResponse = z.infer<typeof adminResponseSchema>;

/** Stage update request. Validated against the ordered enum. */
export const stageUpdateSchema = z.object({
  stage: z.enum(STAGES, { message: "unknown stage value" }),
});

export const policySearchSchema = z.object({
  q: z.string().trim().min(1, "a question is required").max(500),
});

/** Authorization failure shape, shared by every route. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
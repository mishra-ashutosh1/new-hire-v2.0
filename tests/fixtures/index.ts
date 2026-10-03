/**
 * Fixtures (T025) — payloads ACTUALLY OBSERVED against the live endpoints on
 * 2026-10-02. Using real response shapes rather than invented ones is the
 * point: the three-state trap and the empty-answer trap are the behaviours most
 * likely to be missed by a hand-written mock.
 */
import type { RawSheetRow } from "@/lib/sheets/client";

/** onboarding-progress: success (employee 1201, verbatim). */
export const progressSuccess = {
  status: "success",
  temp_emp_id: "1201",
  name: "Ashish Kumar",
  role: "Developer - Lead",
  onboarding_stage: "",
  onboarding_status: "welcome_sent",
  percent_complete: 0,
  completed_count: 0,
  total_items: 4,
  completed: [],
  outstanding: [
    "IT ticket closed",
    "Onboarding task completed",
    "Meet & greet with team",
    "Onboarding status confirmed",
  ],
  can_update_stage: true,
  requested_stage_update: false,
  message: "Onboarding progress retrieved for 1201.",
};

/**
 * onboarding-progress: success with NO checklist (employee 1201, verbatim
 * 2026-10-03, after the `onboarding_stage` column was blanked).
 *
 * Kept because this is the most dangerous shape the endpoint returns. `completed`
 * AND `outstanding` are both empty — identical to "everything is done" — while
 * `checklist_source` is `"none"` and `total_items` is 3. A UI that renders the
 * empty case as "All items complete" tells a real new hire they have finished
 * onboarding when nothing is being tracked at all.
 */
export const progressNoChecklist = {
  status: "success",
  temp_emp_id: "1201",
  name: "Ashish Kumar",
  role: "Developer - Lead",
  onboarding_stage: "",
  onboarding_status: null,
  welcome_status: "welcome_sent",
  percent_complete: 0,
  completed_count: 0,
  total_items: 3,
  completed: [],
  outstanding: [],
  checklist_source: "none",
  can_update_stage: true,
  requested_stage_update: false,
  message: "Onboarding progress retrieved for 1201.",
};

/**
 * onboarding-progress: success where the stage IS a chip, so `checklist_source`
 * is `"onboarding_stage"` and `outstanding` echoes the chips (verbatim 2026-10-03,
 * employee 1302). Note `completed_count: 1` alongside `completed: []` — an
 * upstream inconsistency preserved rather than papered over.
 */
export const progressFromChips = {
  status: "success",
  temp_emp_id: "1302",
  name: "Admin Test User",
  role: "Software Engineer",
  onboarding_stage: "Not Started",
  onboarding_status: null,
  welcome_status: "welcome_sent",
  percent_complete: 33,
  completed_count: 1,
  total_items: 3,
  completed: [],
  outstanding: ["Not Started"],
  checklist_source: "onboarding_stage",
  can_update_stage: true,
  requested_stage_update: false,
  message: "Onboarding progress retrieved for 1302.",
};

/** onboarding-progress: not_found — HTTP 200, NOT 404. */
export const progressNotFound = {
  status: "not_found",
  message: "No onboarding record found for does-not-exist-zzz.",
  temp_emp_id: "does-not-exist-zzz",
};

/** onboarding-progress: error — HTTP 200, NOT 400. */
export const progressError = {
  status: "error",
  message: "temp_emp_id is required",
};

/** policy: answered. */
export const policyAnswered = {
  status: "success",
  answer:
    "Employees accrue 15 days of paid leave per calendar year, accruing monthly from their start date.",
  source: "hr_document.md",
};

/** policy: EMPTY ANSWER on a SUCCESSFUL response. The dangerous shape. */
export const policyEmptyAnswer = {
  status: "success",
  answer: "",
  source: "hr_document.md",
};

/** policy: the workflow's own refusal, rendered verbatim. */
export const policyRefusal = {
  status: "success",
  answer:
    "The policy does not provide enough information to answer this question. Please contact People Operations.",
  source: "hr_document.md",
};

/** welcome: idempotent success, NOT an error. */
export const welcomeAlreadySent = {
  status: "already_sent",
  message: "Welcome email has already been sent for this employee.",
  email_sent: false,
};

/** Sheet rows exactly as read from the live sheet (Sheet1). */
export const sheetRows: RawSheetRow[] = [
  {
    rowNumber: 2,
    cells: {
      temp_emp_id: "1201",
      name: "Ashish Kumar",
      role: "Developer - Lead",
      start_date: "2026-09-30",
      cohort: "3",
      emailID: "acm5520@gmail.com",
      total_essentials: "3",
      onboarding_status: "welcome_sent",
    },
  },
  {
    rowNumber: 3,
    cells: {
      temp_emp_id: "1202",
      name: "Test User Production",
      role: "QA Engineer",
      start_date: "2026-10-01",
      cohort: "4",
      emailID: "test@example.com",
      total_essentials: "3",
      onboarding_status: "welcome_sent",
    },
  },
  {
    rowNumber: 4,
    // Real placeholder row from the live sheet: no valid id, invalid email.
    cells: {
      name: "fafsa",
      role: "fasfsa",
      start_date: "2026-09-27",
      emailID: "fsafa@gma.com",
      total_essentials: "4",
      onboarding_status: "welcome_sent",
    },
  },
];

/**
 * Mixed-typed cells. `RawSheetRow.cells` is typed as strings because that is
 * what the Sheets API returns with FORMATTED_VALUE, so numeric and blank cells
 * are expressed the way they actually arrive — as strings — while still
 * exercising the mixed-type paths.
 */
export const mixedTypeRows: RawSheetRow[] = [
  { rowNumber: 2, cells: { temp_emp_id: "1201", name: "Numeric Id", cohort: "3" } },
  { rowNumber: 3, cells: { temp_emp_id: "  1202  ", name: "String Id", cohort: "  " } },
  { rowNumber: 4, cells: { temp_emp_id: "", name: "Blank Id", cohort: "" } },
];

/** Rows where the API genuinely yields a JS number (UNFORMATTED, or a direct call). */
export const trulyNumericRows = [
  { rowNumber: 2, cells: { temp_emp_id: 1201, name: "Numeric Id", cohort: 3 } },
];

export function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: "1201",
    name: "Ashish Kumar",
    role: "Developer - Lead",
    startDate: "2026-09-30",
    cohort: "3",
    email: "acm5520@gmail.com",
    totalEssentials: 3,
    stage: null,
    stageStatus: "welcome_sent",
    ...overrides,
  };
}

/** A raw sheet row carrying a column the schema does not know about. */
export function rawRow(cells: Record<string, string>): RawSheetRow {
  return { rowNumber: 2, cells };
}
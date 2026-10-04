import type { RawSheetRow } from "@/lib/sheets/client";

/**
 * Demo roster (T067).
 *
 * Seeded from the shapes OBSERVED on the live sheet and workflow, not invented:
 * the id format is numeric-string, `emailID` is the column name, and
 * `welcome_status` (NOT `onboarding_status`) is the welcome column. Inventing
 * plausible-looking fixtures would hide exactly the contract drift demo mode is
 * supposed to make visible.
 *
 * Process-local by design. A hire created during a demo is appended here and
 * vanishes on restart, which is the honest behaviour: nothing was written
 * anywhere, so there is nothing to persist.
 */

/** Seed rows. `fafsa` is the real garbage row — demo mode keeps it quarantined. */
const SEED: readonly RawSheetRow[] = [
  {
    rowNumber: 2,
    cells: {
      temp_emp_id: "1401",
      name: "Ashish Kumar",
      role: "Developer - Lead",
      start_date: "2026-09-30",
      cohort: "3",
      emailID: "ashish.kumar@company.com",
      total_essentials: "3",
      welcome_status: "welcome_sent",
    },
  },
  {
    rowNumber: 3,
    cells: {
      temp_emp_id: "1402",
      name: "Priya Nair",
      role: "QA Engineer",
      start_date: "2026-10-01",
      cohort: "4",
      emailID: "priya.nair@company.com",
      total_essentials: "3",
      welcome_status: "welcome_sent",
    },
  },
  {
    rowNumber: 4,
    cells: {
      temp_emp_id: "1403",
      name: "Rahul Verma",
      role: "Software Engineer",
      start_date: "2026-10-06",
      cohort: "4",
      emailID: "rahul.verma@company.com",
      total_essentials: "4",
      onboarding_stage: "Day 1",
      welcome_status: "welcome_sent",
    },
  },
  {
    rowNumber: 5,
    cells: {
      // The live sheet's real malformed row. Kept so the demo shows quarantine
      // behaviour instead of hiding it behind tidy data.
      name: "fafsa",
      role: "fasfsa",
      start_date: "2026-09-27",
      emailID: "fsafa@gma.com",
      total_essentials: "4",
    },
  },
];

let created: RawSheetRow[] = [];

/** Ids already present, for the duplicate check the real workflow performs. */
export function demoKnownIds(): Set<string> {
  return new Set(
    [...SEED, ...created]
      .map((row) => row.cells.temp_emp_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

/** Seed + created rows, keyed by id. Used to shape demo progress payloads. */
export function demoEmployee(id: string): Record<string, string> | undefined {
  return [...SEED, ...created].find((row) => row.cells.temp_emp_id === id)?.cells;
}

export function demoRosterRows(): RawSheetRow[] {
  return [...SEED, ...created];
}

/**
 * Append a hire created during a demo.
 *
 * The `welcome_status` column is left EMPTY deliberately. The real workflow writes
 * `welcome_sent` there after emailing the person; in demo mode no email exists, so
 * writing it would be the exact lie this module refuses to tell.
 */
export function addDemoEmployee(cells: Record<string, string>): void {
  created = [...created, { rowNumber: SEED.length + created.length + 2, cells }];
}
import { mapSheetRow, namedEmployeeRowSchema, toEmployeeRow } from "@/lib/contracts/schemas";
import type { EmployeeRow } from "@/lib/contracts/schemas";
import type { QuarantinedRow } from "@/types/domain";
import type { RawSheetRow } from "./client";

/**
 * Ingest pipeline (T016).
 *
 * Per-row `safeParse`, NEVER array-level parsing. Array-level parsing
 * (`z.array(rowSchema).parse(rows)`) throws on the first bad row and takes
 * down the entire poll — and the live sheet contains a real garbage row
 * (`fafsa` / `fasfsa` / `fsafa@gma.com`). One malformed employee must never
 * blank the tracker (FR-021).
 *
 * This module NEVER deletes or repairs sheet rows. HR owns that data; the app
 * quarantines and reports.
 */

export interface IngestResult {
  employees: EmployeeRow[];
  quarantined: QuarantinedRow[];
}

export function ingestRows(rows: readonly RawSheetRow[]): IngestResult {
  const employees: EmployeeRow[] = [];
  const quarantined: QuarantinedRow[] = [];

  for (const row of rows) {
    // Translate sheet column names to domain field names before validating.
    const parsed = namedEmployeeRowSchema.safeParse(mapSheetRow(row.cells));

    if (parsed.success) {
      employees.push(toEmployeeRow(parsed.data));
      continue;
    }

    // Preserve enough detail for HR to locate and understand the failure.
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(row)";
      return `${field}: ${issue.message}`;
    });
    quarantined.push({ rowNumber: row.rowNumber, raw: row.cells, issues });
  }

  return { employees, quarantined };
}

/**
 * Heuristic for FR-012: "must NOT display placeholder or malformed records as if
 * they were real employees."
 *
 * The `fafsa` row is quarantined by validation alone (no valid email, no id).
 * This catches the harder case: a row that IS structurally valid but is
 * obviously filler. Kept separate and explicit so the rule is auditable rather
 * than an opaque heuristic buried in ingest.
 */
const PLACEHOLDER_PATTERNS = [
  /^f[a-z]*sa$/i, // "fafsa", "fasfsa" — the observed fixture
  /^(test|dummy|sample|placeholder|todo|tbd|xxx+|asdf+)$/i,
  /^lorem\b/i,
];

export function looksLikePlaceholder(employee: {
  name: string | null;
  email?: string | null;
}): boolean {
  const name = employee.name ?? "";
  const email = employee.email?.toLowerCase() ?? "";
  // A gmail/other address on an obviously-filler name is the observed pattern.
  const nameLooksFiller = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(name));
  const emailLooksFiller = email.startsWith("fsafa@") || email.startsWith("test@");
  return nameLooksFiller || emailLooksFiller;
}

export interface CleanedRoster extends IngestResult {
  /** Rows dropped as plausible-but-filler, separated from hard validation failures. */
  filteredPlaceholders: QuarantinedRow[];
}

/**
 * Ingest plus placeholder filtering. Placeholders are reported to operators
 * separately from validation failures, because the reasons differ: one is a
 * data-format problem, the other is stale test data needing cleanup.
 */
export function ingestRoster(rows: readonly RawSheetRow[]): CleanedRoster {
  const { employees, quarantined } = ingestRows(rows);
  const kept: EmployeeRow[] = [];
  const filteredPlaceholders: QuarantinedRow[] = [];

  employees.forEach((employee, index) => {
    if (looksLikePlaceholder(employee)) {
      const rowNumber = rows[index]?.rowNumber ?? index + 2;
      filteredPlaceholders.push({
        rowNumber,
        raw: rows[index]?.cells ?? {},
        issues: ["record appears to be placeholder or test data"],
      });
    } else {
      kept.push(employee);
    }
  });

  return { employees: kept, quarantined, filteredPlaceholders };
}
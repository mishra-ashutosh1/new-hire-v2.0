import type { Employee } from "@/types/domain";

/**
 * PII-allowlist serializer (T019).
 *
 * This is an ALLOWLIST, deliberately. A denylist would mean every future sheet
 * column is exposed until someone remembers to add it to a blocklist — the
 * failure mode is silent leakage. With an allowlist, a new column is excluded by
 * default and a leak requires someone to explicitly add it here.
 *
 * tests/unit/pii.test.ts asserts this property by adding a `salary` column to a
 * fixture sheet and confirming it appears in no response. That test is written
 * to FAIL if this module is ever converted to a denylist (FR-024, SC-010).
 */

/** The complete set of fields permitted to leave the server. */
export const DISCLOSABLE_FIELDS = [
  "id",
  "name",
  "role",
  "startDate",
  "cohort",
  "email",
  "totalEssentials",
  "stage",
  "stageStatus",
] as const;

export type DisclosableField = (typeof DISCLOSABLE_FIELDS)[number];

/**
 * Fields that must never be returned, in any shape, under any role. Named
 * explicitly here so the prohibition is visible in code and reviewable, even
 * though the allowlist above already excludes them.
 */
export const PROHIBITED_FIELDS = [
  "compensation",
  "salary",
  "health",
  "medical",
  "benefitsElection",
  "benefits_election",
  "governmentId",
  "government_id",
  "ssn",
  "bankAccount",
  "dateOfBirth",
  "address",
] as const;

export interface SerializedEmployee {
  id: string;
  name: string;
  role: string | null;
  startDate: string | null;
  cohort: string | null;
  email: string | null;
  totalEssentials: number | null;
  stage: string | null;
  stageStatus: string | null;
}

/**
 * Accepts `SerializedEmployee` rather than the narrower `Employee` domain type.
 *
 * `Employee.stage` is typed `Stage | null`, but ingest preserves the sheet's
 * RAW label in that field (schemas.ts `toEmployeeRow` uses `asText`), so a live
 * value like "Not Started" is not a `Stage`. Typing the input at `Stage` made
 * the tracker route unable to pass a resolved display label. `SerializedEmployee`
 * is all-`string`, so `Employee` remains valid input and every existing caller
 * keeps compiling unchanged.
 */
export function serializeEmployee(employee: SerializedEmployee): SerializedEmployee {
  // Constructed field by field from the allowlist. There is no spread and no
  // `delete`, so an unexpected property on the input cannot pass through.
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    startDate: employee.startDate,
    cohort: employee.cohort,
    email: employee.email,
    totalEssentials: employee.totalEssentials,
    stage: employee.stage,
    stageStatus: employee.stageStatus,
  };
}

export function serializeEmployees(employees: readonly Employee[]): SerializedEmployee[] {
  return employees.map(serializeEmployee);
}

/** Fields actually disclosed, for the audit record. */
export function disclosedFields(): string[] {
  return [...DISCLOSABLE_FIELDS];
}

/** Defence in depth for test assertions. */
export function containsProhibitedField(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return Object.keys(record).some((key) =>
    (PROHIBITED_FIELDS as readonly string[]).includes(key),
  );
}
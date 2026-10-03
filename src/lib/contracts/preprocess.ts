import { z } from "zod";

/**
 * Mixed-type cell preprocessor (T011).
 *
 * The sheet is written by humans and by n8n, so column types are not
 * consistent. Verified on 2026-10-02:
 *   - `temp_emp_id` appears as text ("1201") AND is blank in one row
 *   - `cohort` appears as text and number, and is blank in one row
 *   - `start_date` is an ISO string, NOT a Google serial date
 *
 * Rule for `temp_emp_id`: it is NEVER coerced to a number. It is the join key
 * for every webhook call, so a coerced "01201" -> 1201 would silently break
 * lookups. Blank is the one hard reject — every downstream lookup keys on it.
 */

/**
 * General free-text cell. Typed `z.unknown()` because a missing optional field
 * must be tolerated; consumers narrow it back with `asText()` rather than
 * assuming a string.
 */
export const cell = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}, z.unknown());

/** Narrow an unknown cell to text, or null when absent. */
export function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Numeric-tolerant cell: accepts a real number or a numeric string. */
export const numericCell = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return value;
}, z.number().int().nonnegative().optional());

/**
 * Identifier cell. Stays a string on purpose — see the module docstring.
 * Rejects an empty value so a blank id can never reach a webhook call.
 */
export const idCell = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}, z.string().min(1, "employee identifier is required"));

/**
 * Cohort cell. Blank maps to null and NEVER to 0 — 0 would collide with a real
 * identifier and be rendered as a genuine cohort.
 */
export const cohortCell = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return null;
}, z.string().nullable());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO date cell. Read with FORMATTED_VALUE, never UNFORMATTED — UNFORMATTED
 * returns serials for any cell an HR user later reformats as a true date,
 * silently changing the type underneath the app.
 */
export const isoDateCell = z.preprocess((value) => {
  // Returns null (never undefined) for anything unusable, so the schema's
  // `.nullable()` accepts it and an absent date stays null rather than
  // becoming a validation failure that quarantines an otherwise-valid row.
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return null; // a serial date, which must never pass
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates like 2026-02-31, which the regex alone accepts.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return trimmed;
}, z.string().nullable());

export const emailCell = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.toLowerCase();
}, z.string().email("invalid email format").optional());
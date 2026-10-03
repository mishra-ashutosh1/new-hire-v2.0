import { describe, expect, it } from "vitest";
import { ingestRows, ingestRoster, looksLikePlaceholder } from "@/lib/sheets/ingest";
import { mixedTypeRows, sheetRows } from "../fixtures";

/**
 * T026 — per-row quarantine.
 *
 * The live sheet contains a real garbage row (`fafsa` / `fsafa@gma.com`). If
 * ingest parsed the array in one shot, that row would throw and blank the
 * entire tracker. These tests assert the opposite.
 */
describe("ingestRows", () => {
  it("ingests valid rows and quarantines the malformed one without throwing", () => {
    const result = ingestRows(sheetRows);

    // Two valid employees survive.
    expect(result.employees.length).toBeGreaterThanOrEqual(2);
    // The garbage row is quarantined, NOT silently dropped.
    expect(result.quarantined.length).toBe(1);
    expect(result.quarantined[0]?.rowNumber).toBe(4);
  });

  it("records a sheet-relative row number so HR can locate the failure", () => {
    const { quarantined } = ingestRows(sheetRows);
    // Row 4 in the sheet, not index 2 in the parsed array.
    expect(quarantined[0]?.rowNumber).toBe(4);
    expect(quarantined[0]?.issues.length).toBeGreaterThan(0);
  });

  it("always returns a successful result even when every row is invalid", () => {
    const result = ingestRows([
      { rowNumber: 2, cells: { temp_emp_id: "", name: "" } },
      { rowNumber: 3, cells: { name: "No Id At All" } },
    ]);
    expect(result.employees).toHaveLength(0);
    expect(result.quarantined).toHaveLength(2);
  });

  it("tolerates an empty sheet", () => {
    const result = ingestRows([]);
    expect(result).toEqual({ employees: [], quarantined: [] });
  });
});

describe("mixed-type handling", () => {
  it("accepts numeric and string ids, rejecting only a blank id", () => {
    const result = ingestRows(mixedTypeRows);
    const ids = result.employees.map((e) => e.id);

    expect(ids).toContain("1201"); // numeric 1201 -> string "1201"
    expect(ids).toContain("1202"); // "  1202  " -> trimmed "1202"

    // The blank id is the one hard reject: every webhook lookup keys on it.
    expect(ids).not.toContain("");
    expect(result.quarantined.some((q) => q.raw.name === "Blank Id")).toBe(true);
  });

  it("maps a blank cohort to null and never to 0", () => {
    const result = ingestRows(mixedTypeRows);
    const blankCohort = result.employees.find((e) => e.name === "String Id");
    // 0 would collide with a real identifier and render as a genuine cohort.
    expect(blankCohort?.cohort).toBeNull();
    expect(blankCohort?.cohort).not.toBe(0);
  });
});

describe("placeholder detection (FR-012)", () => {
  it("keeps the observed fafsa row out of the employee roster", () => {
    const result = ingestRoster(sheetRows);
    // It has no temp_emp_id, so validation quarantines it BEFORE placeholder
    // detection runs. The requirement (FR-012) is that it never appears as a
    // real employee — which holds via the quarantine channel, not the
    // placeholder channel.
    const inRoster = result.employees.some((e) => e.name === "fafsa");
    expect(inRoster).toBe(false);
    expect(
      result.quarantined.some((q) => q.raw.name === "fafsa") ||
        result.filteredPlaceholders.some((p) => p.raw.name === "fafsa"),
    ).toBe(true);
  });

  it("does not flag legitimate employees", () => {
    const result = ingestRoster(sheetRows);
    const names = result.employees.map((e) => e.name);
    expect(names).toContain("Ashish Kumar");
    expect(names).not.toContain("fafsa");
  });

  it("reports placeholders separately from validation failures", () => {
    // A structurally-valid row whose content is filler reaches the placeholder
    // channel; a structurally-broken row reaches quarantine. Different
    // reasons need different fixes from HR.
    const result = ingestRoster([
      { rowNumber: 2, cells: { temp_emp_id: "9", name: "placeholder", emailID: "a@b.com" } },
      { rowNumber: 3, cells: { name: "No Id", emailID: "a@b.com" } },
    ]);
    expect(result.filteredPlaceholders.length).toBe(1);
    expect(result.quarantined.length).toBe(1);
    expect(result.employees.length).toBe(0);
  });
});

describe("looksLikePlaceholder", () => {
  it("matches known filler patterns", () => {
    expect(looksLikePlaceholder({ name: "fafsa" } as never)).toBe(true);
    expect(looksLikePlaceholder({ name: "test" } as never)).toBe(true);
    expect(looksLikePlaceholder({ name: "placeholder" } as never)).toBe(true);
  });

  it("does not match real names", () => {
    expect(looksLikePlaceholder({ name: "Ashish Kumar" } as never)).toBe(false);
    expect(looksLikePlaceholder({ name: "Testflight Runner" } as never)).toBe(false);
  });
});
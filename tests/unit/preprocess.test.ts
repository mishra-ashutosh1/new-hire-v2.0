import { describe, expect, it } from "vitest";
import { cell, cohortCell, emailCell, idCell, isoDateCell, numericCell } from "@/lib/contracts/preprocess";

/**
 * T027 — mixed-type coercion.
 *
 * The sheet stores `temp_emp_id` and `cohort` as both text and numbers, with
 * blanks in both. These are the rules that keep joins working.
 */
describe("idCell", () => {
  it("preserves a numeric id as a string rather than coercing it", () => {
    // "01201" -> 1201 would silently break every webhook lookup.
    const result = idCell.parse(1201);
    expect(result).toBe("1201");
    expect(typeof result).toBe("string");
  });

  it("trims a string id", () => {
    expect(idCell.parse("  1202  ")).toBe("1202");
  });

  it("rejects a blank id — the one hard reject", () => {
    // Every downstream lookup keys on this value.
    expect(() => idCell.parse("")).toThrow();
    expect(() => idCell.parse("   ")).toThrow();
    expect(() => idCell.parse(null)).toThrow();
  });

  it("rejects an empty string that survives trimming", () => {
    expect(() => idCell.parse("")).toThrow(/required/i);
  });
});

describe("cohortCell", () => {
  it("maps blank to null and never to 0", () => {
    expect(cohortCell.parse("")).toBeNull();
    expect(cohortCell.parse("  ")).toBeNull();
    expect(cohortCell.parse(null)).toBeNull();
    // 0 would collide with a real identifier.
    expect(cohortCell.parse("")).not.toBe(0);
  });

  it("stringifies numeric cohorts", () => {
    expect(cohortCell.parse(3)).toBe("3");
    expect(cohortCell.parse("4")).toBe("4");
  });

  it("preserves a real cohort value", () => {
    expect(cohortCell.parse("7")).toBe("7");
  });
});

describe("numericCell", () => {
  it("coerces numeric strings", () => {
    expect(numericCell.parse("3")).toBe(3);
    expect(numericCell.parse(4)).toBe(4);
  });

  it("maps blank to undefined rather than 0", () => {
    expect(numericCell.parse("")).toBeUndefined();
    expect(numericCell.parse(null)).toBeUndefined();
  });

  it("rejects non-numeric text", () => {
    expect(() => numericCell.parse("fasfsa")).toThrow();
  });
});

describe("isoDateCell", () => {
  it("accepts a valid ISO date", () => {
    expect(isoDateCell.parse("2026-09-30")).toBe("2026-09-30");
  });

  it("rejects an impossible calendar date that the regex alone accepts", () => {
    // 2026-02-31 matches ^\d{4}-\d{2}-\d{2}$ but does not exist.
    expect(isoDateCell.parse("2026-02-31")).toBeNull();
    expect(isoDateCell.parse("2026-13-01")).toBeNull();
  });

  it("rejects a serial date, which UNFORMATTED would have produced", () => {
    expect(isoDateCell.parse(46292)).toBeNull();
  });

  it("returns null for blank", () => {
    expect(isoDateCell.parse("")).toBeNull();
  });
});

describe("emailCell", () => {
  it("lowercases and validates", () => {
    expect(emailCell.parse("  ACM5520@Gmail.com ")).toBe("acm5520@gmail.com");
  });

  it("accepts a syntactically valid but unusual domain", () => {
    // Verified against zod: "gma.com" passes .email(). The observed fafsa row
    // is therefore quarantined by its MISSING temp_emp_id, not by its email.
    // Asserting otherwise would encode a false belief about the data.
    expect(emailCell.parse("fsafa@gma.com")).toBe("fsafa@gma.com");
  });

  it("rejects a structurally malformed address", () => {
    expect(() => emailCell.parse("fsafa@")).toThrow();
    expect(() => emailCell.parse("not-an-email")).toThrow();
  });
});

describe("cell", () => {
  it("trims and collapses blanks to undefined", () => {
    expect(cell.parse("  hi  ")).toBe("hi");
    expect(cell.parse("")).toBeUndefined();
  });
});
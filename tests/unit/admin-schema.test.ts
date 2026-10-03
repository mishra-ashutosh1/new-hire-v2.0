import { describe, expect, it } from "vitest";
import { adminRequestSchema } from "@/lib/contracts/schemas";

/**
 * T056 / T064 — the provisioning request schema.
 *
 * CONFIRMED against the live Admin workflow's `Validate New Hire1` node
 * (2026-10-02). The node source is:
 *
 *   if (!record.temp_emp_id) errors.push('temp_emp_id is required');
 *   if (!record.name)        errors.push('name is required');
 *   if (!record.role)        errors.push('role is required');
 *   if (!record.emailID)     errors.push('emailID is required');
 *
 * So `temp_emp_id` is required FROM THE CLIENT. These tests previously asserted
 * the opposite — that a client-supplied `temp_emp_id` and `totalEssentials` must
 * be REJECTED — on the belief that both were workflow-generated. That belief was
 * wrong, and rejecting `temp_emp_id` guaranteed a 400 from the workflow on every
 * real provisioning call.
 */
describe("adminRequestSchema", () => {
  const valid = {
    tempEmpId: "1203",
    name: "Jordan Reyes",
    role: "QA Engineer",
    startDate: "2026-11-03",
    email: "jordan.reyes@example.com",
    cohort: "5",
  };

  /** The four fields the workflow actually validates. */
  const minimumValid = {
    tempEmpId: "1203",
    name: "Jordan Reyes",
    role: "QA Engineer",
    email: "jordan.reyes@example.com",
  };

  it("accepts a well-formed payload", () => {
    expect(adminRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts ONLY the four required fields — startDate is optional", () => {
    // start_date is picked by the node but never required, so demanding it
    // would reject valid hires.
    const result = adminRequestSchema.safeParse(minimumValid);
    expect(result.success).toBe(true);
  });

  it("REQUIRES tempEmpId", () => {
    expect(adminRequestSchema.safeParse({ ...valid, tempEmpId: "" }).success).toBe(false);
    expect(adminRequestSchema.safeParse({ ...valid, tempEmpId: "   " }).success).toBe(false);
    const { tempEmpId: _omitted, ...withoutId } = valid;
    expect(adminRequestSchema.safeParse(withoutId).success).toBe(false);
  });

  it("ACCEPTS a client-supplied totalEssentials", () => {
    // Copied straight from the request by the node; not workflow-generated.
    const result = adminRequestSchema.safeParse({ ...valid, totalEssentials: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalEssentials).toBe(3);
  });

  it("still REJECTS the snake_case wire key on the BFF request", () => {
    // The BFF speaks camelCase; `temp_emp_id` is the WIRE name and only the
    // route's outbound mapping emits it. Accepting it here would create two
    // spellings for one field.
    const result = adminRequestSchema.safeParse({ ...valid, temp_emp_id: "9999" });
    expect(result.success).toBe(false);
  });

  it("REJECTS unknown fields rather than ignoring them", () => {
    // Silently dropping an unexpected field hides a contract mismatch, which is
    // exactly how the admin contract drifted in the first place.
    expect(adminRequestSchema.safeParse({ ...valid, salary: "120000" }).success).toBe(false);
  });

  it("requires name and role", () => {
    expect(adminRequestSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(adminRequestSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(adminRequestSchema.safeParse({ ...valid, role: "" }).success).toBe(false);
  });

  it("requires a valid email", () => {
    expect(adminRequestSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("validates a start date ONLY when one is supplied", () => {
    expect(adminRequestSchema.safeParse({ ...valid, startDate: "2026-11-03" }).success).toBe(true);
    expect(adminRequestSchema.safeParse({ ...valid, startDate: "03/11/2026" }).success).toBe(false);
    expect(adminRequestSchema.safeParse({ ...valid, startDate: null }).success).toBe(true);
  });

  it("reports each failing field so errors attach to inputs", () => {
    const result = adminRequestSchema.safeParse({
      tempEmpId: "",
      name: "",
      email: "bad",
      startDate: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join("."));
      expect(fields).toContain("tempEmpId");
      expect(fields).toContain("name");
      expect(fields).toContain("email");
      expect(fields).toContain("startDate");
    }
  });

  it("treats the optional fields as optional and nullable", () => {
    for (const key of ["cohort", "totalEssentials", "completedEssentials", "onboardingStage"]) {
      expect(adminRequestSchema.safeParse({ ...valid, [key]: undefined }).success, key).toBe(true);
      expect(adminRequestSchema.safeParse({ ...valid, [key]: null }).success, key).toBe(true);
    }
  });

  it("treats a BLANK form input as absent, not as a validation error", () => {
    // An untouched <input> or <select> posts "". `.nullish()` alone accepts
    // null/undefined but NOT "", so without the blank-string preprocessing a
    // hire with no cohort and no start date would 400 at the BFF even though the
    // workflow copies those fields through when present.
    for (const key of ["cohort", "startDate", "onboardingStage", "totalEssentials"]) {
      expect(adminRequestSchema.safeParse({ ...valid, [key]: "" }).success, key).toBe(true);
      expect(adminRequestSchema.safeParse({ ...valid, [key]: "   " }).success, key).toBe(true);
    }
  });

  it("normalises blank optionals to null so the route omits them", () => {
    const result = adminRequestSchema.safeParse({ ...valid, cohort: "", startDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cohort).toBeNull();
      expect(result.data.startDate).toBeNull();
    }
  });
});
import { describe, expect, it } from "vitest";
import { classifyAdmin } from "@/lib/n8n/classify";

/**
 * Shapes below are copied from the EXPORTED `Admin` n8n workflow
 * (`Admin.json`, verified 2026-10-02), specifically the three
 * `respondToWebhook` branches. If the workflow changes, these tests are the
 * ones that should fail loudly.
 */

describe("admin webhook classification", () => {
  it("maps the workflow's 'ok' to created — NOT the portal's 'success'", () => {
    const result = classifyAdmin({
      status: "ok",
      temp_emp_id: "1401",
      name: "Priya Nair",
      emailID: "priya@example.com",
      onboarding_status: "welcome_sent",
    });

    expect(result).toEqual({
      outcome: "created",
      tempEmpId: "1401",
      name: "Priya Nair",
    });
  });

  it("also accepts 'success' so a workflow edit cannot silently break this", () => {
    const result = classifyAdmin({ status: "success", temp_emp_id: "1402" });
    expect(result.outcome).toBe("created");
  });

  it("treats 'already_processed' as NOT created", () => {
    const result = classifyAdmin({
      status: "already_processed",
      message:
        "This employee already has a row in Sheet1; no row was appended and no duplicate welcome email was sent.",
      temp_emp_id: "1403",
      name: "Existing Hire",
      emailID: "existing@example.com",
      onboarding_status: "already_in_sheet",
    });

    expect(result.outcome).toBe("already_exists");
    if (result.outcome !== "already_exists") throw new Error("unreachable");
    expect(result.tempEmpId).toBe("1403");
    expect(result.message).toContain("no row was appended");
  });

  it("surfaces the workflow's field-level errors on rejection", () => {
    const result = classifyAdmin({
      status: "error",
      message: "Invalid new hire payload",
      temp_emp_id: "",
      errors: ["temp_emp_id is required", "emailID is not a valid email address"],
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") throw new Error("unreachable");
    expect(result.errors).toEqual([
      "temp_emp_id is required",
      "emailID is not a valid email address",
    ]);
  });

  it("never lets onboarding_status stand in for onboarding progress", () => {
    // The sheet column is welcome_status. An onboarding_* key in a provisioning
    // response must not become an onboarding stage anywhere downstream.
    const result = classifyAdmin({
      status: "ok",
      temp_emp_id: "1404",
      onboarding_status: "welcome_sent",
    });

    expect(result).toEqual({ outcome: "created", tempEmpId: "1404", name: null });
    expect(Object.keys(result)).not.toContain("onboardingStatus");
    expect(JSON.stringify(result)).not.toContain("welcome_sent");
  });

  it("fails closed on a malformed body rather than assuming success", () => {
    const result = classifyAdmin({ unexpected: true });
    expect(result.outcome).toBe("rejected");
  });

  it("fails closed on a completely empty body", () => {
    expect(classifyAdmin(undefined).outcome).toBe("rejected");
    expect(classifyAdmin(null).outcome).toBe("rejected");
    expect(classifyAdmin("nonsense").outcome).toBe("rejected");
  });
});
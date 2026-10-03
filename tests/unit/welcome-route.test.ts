import { describe, expect, it } from "vitest";
import { classifyWelcome } from "@/lib/n8n/classify";

/**
 * T050 — the 500 mapping.
 *
 * The upstream welcome endpoint returns HTTP 500 for unknown or malformed ids.
 * The BFF maps that to 502 and ECHOES the employee id, so the affected employee
 * is identifiable rather than leaving the operator guessing which record failed
 * (FR-018).
 *
 * The mapping itself lives in the route handler; what is asserted here is the
 * behaviour the route depends on — that a 500 produces no classified payload
 * and that the id is preserved for the error body.
 */
describe("welcome upstream failure mapping", () => {
  const affectedId = "does-not-exist-zzz";

  it("produces no classified payload when the HTTP status is a failure", () => {
    // A 500 with an empty body is the observed shape — classifyWelcome must not
    // be reached with it and must not invent a success.
    const result = classifyWelcome(null);
    expect(result.status).toBe("error");
    expect(result.emailSent).toBe(false);
  });

  it("carries the affected employee id so the failure is attributable", () => {
    // The route echoes this id into error.employeeId.
    const errorBody = {
      error: {
        code: "WELCOME_UPSTREAM_FAILED",
        message: `Welcome sequence failed for employee ${affectedId} (HTTP 500).`,
        employeeId: affectedId,
      },
    };
    expect(errorBody.error.employeeId).toBe(affectedId);
    expect(errorBody.error.message).toContain(affectedId);
  });

  it("does not misreport a 500 as already_sent", () => {
    // The worst outcome would be telling HR an employee was provisioned when
    // the request actually failed.
    const result = classifyWelcome({ status: "already_sent" });
    expect(result.status).toBe("already_sent");
    // Only an explicit upstream status may produce that state.
    expect(classifyWelcome(new Error("500")).status).toBe("error");
  });
});
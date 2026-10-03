import { afterAll, describe, expect, it } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  canAccessModule,
  canViewEmployee,
  type Session,
} from "@/lib/auth/session";

/**
 * T017 / T076 — authorization primitives.
 *
 * Authorization runs BEFORE data is fetched. Hiding a nav item is presentation,
 * not access control (FR-023), so the module map and the scope check are the
 * actual enforcement surface.
 */

// The session signer fails CLOSED when the secret is absent or too short, which
// is correct production behaviour but would throw here. Provide one for the
// duration of the module.
process.env.SESSION_SECRET = "test-secret-value-that-is-at-least-32-chars";
afterAll(() => {
  delete process.env.SESSION_SECRET;
});

const HR: Session = { email: "hr@company.com", role: "hr_admin", scopedEmployeeIds: null };
const MANAGER: Session = {
  email: "mgr@company.com",
  role: "manager",
  scopedEmployeeIds: ["1201", "1202"],
};
const NEW_HIRE: Session = { email: "hire@company.com", role: "new_hire", scopedEmployeeIds: null };

describe("module access", () => {
  it("restricts welcome and new-hire to hr_admin", () => {
    expect(canAccessModule("hr_admin", "welcome")).toBe(true);
    expect(canAccessModule("hr_admin", "new-hire")).toBe(true);
    // A new hire must never reach provisioning or the welcome console.
    expect(canAccessModule("new_hire", "welcome")).toBe(false);
    expect(canAccessModule("new_hire", "new-hire")).toBe(false);
    expect(canAccessModule("manager", "welcome")).toBe(false);
    expect(canAccessModule("manager", "new-hire")).toBe(false);
  });

  it("allows every role to view the tracker and policies", () => {
    for (const role of ["hr_admin", "manager", "new_hire"] as const) {
      expect(canAccessModule(role, "tracker")).toBe(true);
      expect(canAccessModule(role, "policies")).toBe(true);
    }
  });
});

describe("employee scope", () => {
  it("gives hr_admin access to every employee", () => {
    expect(canViewEmployee(HR, "9999")).toBe(true);
  });

  it("limits a manager to their reporting line", () => {
    expect(canViewEmployee(MANAGER, "1201")).toBe(true);
    // Outside the reporting line must be refused.
    expect(canViewEmployee(MANAGER, "7777")).toBe(false);
  });

  it("limits a new hire to their own record", () => {
    expect(canViewEmployee(NEW_HIRE, "1201", "1201")).toBe(true);
    expect(canViewEmployee(NEW_HIRE, "1202", "1201")).toBe(false);
    // With no known self id, nothing is visible.
    expect(canViewEmployee(NEW_HIRE, "1201")).toBe(false);
  });

  /*
   * The collection fan-out filters with canViewEmployee. These cases document
   * why each role gets which subset — a regression here is a PII disclosure to
   * a user who was authorized onto the MODULE but not onto every RECORD.
   */
  it("scopes a new hire to exactly one row", () => {
    const roster = ["1201", "1202", "1203", "1204"];
    const scoped = roster.filter((id) => canViewEmployee(NEW_HIRE, id, "1203"));
    expect(scoped).toEqual(["1203"]);
  });

  it("scopes a manager to their reporting line", () => {
    const roster = ["1201", "1202", "1203", "1204"];
    const scoped = roster.filter((id) => canViewEmployee(MANAGER, id));
    expect(scoped).toEqual(["1201", "1202"]);
  });

  it("gives hr_admin the whole roster", () => {
    const roster = ["1201", "1202", "1203"];
    const scoped = roster.filter((id) => canViewEmployee(HR, id));
    expect(scoped).toEqual(roster);
  });
});

describe("session token", () => {
  it("round-trips a valid session", () => {
    const token = createSessionToken(HR);
    const verified = verifySessionToken(token);
    expect(verified?.role).toBe("hr_admin");
    expect(verified?.email).toBe("hr@company.com");
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(HR);
    const [payload, signature] = token.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...HR, role: "hr_admin", scopedEmployeeIds: null, email: "attacker@x.com" }),
      "utf8",
    ).toString("base64url");
    expect(verifySessionToken(`${forged}.${signature}`)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it("rejects a malformed or absent token", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("no-dot")).toBeNull();
    expect(verifySessionToken("a.b.c")).toBeNull();
  });

  it("does not throw on a signature of the wrong length", () => {
    // timingSafeEqual throws on a length mismatch; the verifier must guard it.
    expect(() => verifySessionToken("abc.def")).not.toThrow();
  });
});
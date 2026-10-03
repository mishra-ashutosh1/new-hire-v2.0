import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeAuditEvent } from "@/lib/audit/writer";

/**
 * T078 — audit ordering (FR-025).
 *
 * The audit row is written BEFORE employee data is returned. If the audit
 * write fails, the READ FAILS. This inverts the usual best-effort logging
 * order deliberately: an audit trail that can silently drop entries is not
 * evidence of anything, and unlogged PII must never be served.
 */
describe("audit writer", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      AUDIT_SHEET_ID: "audit-sheet-id",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "sa@project.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
      }),
      SESSION_SECRET: "x".repeat(32),
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("refuses to write when no audit sheet is configured", async () => {
    // Failing closed: an unconfigured audit sink must NOT be silently skipped,
    // because the caller's contract is "fail the read if the audit fails".
    delete process.env.AUDIT_SHEET_ID;
    vi.resetModules();
    const { writeAuditEvent: fresh } = await import("@/lib/audit/writer");

    await expect(
      fresh({
        actorEmail: "hr@company.com",
        action: "list",
        employeeId: "*",
        fieldsDisclosed: ["id"],
        requestId: "req-1",
      }),
    ).rejects.toThrow(/AUDIT_SHEET_ID/);
  });

  it("throws rather than silently succeeding when the append fails", async () => {
    // A transport failure must surface, so the route converts it into a 503
    // instead of disclosing employee data without a record.
    vi.resetModules();
    const google = await import("googleapis");
    const append = vi.fn().mockRejectedValue(new Error("append failed"));

    vi.spyOn(google.google.auth, "GoogleAuth").mockImplementation(
      () => ({}) as never,
    );
    const sheetsMock = { spreadsheets: { values: { append } } };
    vi.spyOn(google.google, "sheets").mockReturnValue(sheetsMock as never);

    await expect(
      writeAuditEvent({
        actorEmail: "hr@company.com",
        action: "view",
        employeeId: "1201",
        fieldsDisclosed: ["id", "name"],
        requestId: "req-2",
      }),
    ).rejects.toThrow();
  });
});
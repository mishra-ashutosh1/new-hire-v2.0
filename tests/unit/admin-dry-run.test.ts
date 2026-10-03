import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T065 — dry run.
 *
 * This is the test that makes the form safe to try. Everything else in this
 * feature touches live data: a roster row, an audit row, and a welcome email to a
 * real address. Without a way to exercise the page harmlessly, "does the
 * provisioning UI work?" can only be answered by creating an employee — which is
 * why it was never finished.
 *
 * The route is imported directly rather than mirrored, because the whole claim is
 * about what the route does NOT call. A mirrored guard cannot prove that.
 */

const getSession = vi.hoisted(() => vi.fn());
const createNewHire = vi.hoisted(() => vi.fn());
const writeAuditEvent = vi.hoisted(() => vi.fn());
const classifyAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  getSession,
  assertModuleAccess: () => {},
  AuthorizationError: class AuthorizationError extends Error {},
}));
vi.mock("@/lib/n8n/client", () => ({ createNewHire }));
vi.mock("@/lib/n8n/classify", () => ({ classifyAdmin }));
vi.mock("@/lib/audit/writer", () => ({ writeAuditEvent }));

const { POST } = await import("@/app/api/admin/new-hire/route");

const VALID_BODY = {
  tempEmpId: "1303",
  name: "Priya Nair",
  role: "QA Engineer",
  email: "priya.nair@company.com",
};

function post(body: unknown, requestId = `req-${Math.random()}`) {
  return POST(
    new Request("http://localhost/api/admin/new-hire", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  process.env.ADMIN_CONTRACT_VERIFIED = "true";
  delete process.env.NEW_HIRE_DRY_RUN;
  getSession.mockResolvedValue({ email: "hr.admin@company.com", role: "hr_admin" });
  createNewHire.mockReset();
  writeAuditEvent.mockReset().mockResolvedValue(undefined);
  classifyAdmin.mockReset();
});

describe("dry run", () => {
  it("validates and reports without calling the workflow", async () => {
    process.env.NEW_HIRE_DRY_RUN = "true";
    const response = await post(VALID_BODY);

    expect(response.status).toBe(200);
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("writes no audit row, because nothing was created", async () => {
    // An audit row saying `create` for a hire that does not exist would be a false
    // record in the compliance trail — worse than no row at all.
    process.env.NEW_HIRE_DRY_RUN = "true";
    await post(VALID_BODY);
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("never claims a record was created", async () => {
    process.env.NEW_HIRE_DRY_RUN = "true";
    const body = await (await post(VALID_BODY)).json();

    expect(body).toMatchObject({ id: "1303", created: false, dryRun: true });
    expect(body.message).toMatch(/nothing was written/i);
    expect(body.message).toMatch(/no welcome email/i);
  });

  it("echoes the exact wire mapping so it can be checked against the workflow", async () => {
    process.env.NEW_HIRE_DRY_RUN = "true";
    const body = await (await post({ ...VALID_BODY, cohort: "5", totalEssentials: 3 })).json();

    expect(body.wire).toEqual({
      temp_emp_id: "1303",
      name: "Priya Nair",
      role: "QA Engineer",
      emailID: "priya.nair@company.com",
      cohort: "5",
      total_essentials: 3,
    });
  });

  it("still rejects invalid input, so it is a real check and not a rubber stamp", async () => {
    process.env.NEW_HIRE_DRY_RUN = "true";
    const response = await post({ name: "No Id" });

    expect(response.status).toBe(400);
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("still refuses a repeated request id", async () => {
    // Otherwise a preview could be double-submitted into a real write later.
    process.env.NEW_HIRE_DRY_RUN = "true";
    await post(VALID_BODY, "req-fixed");
    const second = await post(VALID_BODY, "req-fixed");

    expect(second.status).toBe(409);
  });

  it("creates for real once the flag is off", async () => {
    // The dry run must be a switch, not a replacement for the write path.
    process.env.NEW_HIRE_DRY_RUN = "false";
    createNewHire.mockResolvedValue({ ok: true, httpStatus: 200, body: { status: "ok" } });
    classifyAdmin.mockReturnValue({
      outcome: "created",
      tempEmpId: "1303",
      message: "created",
      errors: [],
    });

    const response = await post(VALID_BODY);

    expect(response.status).toBe(201);
    expect(createNewHire).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
  });
});
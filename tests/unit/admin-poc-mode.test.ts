import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T066 — POC mode.
 *
 * The switch that lets a demo run without signing in. Its whole value is that it
 * bypasses ONE thing, so these tests are mostly about what it must NOT bypass:
 * validation, the duplicate guard, and the feature flag all still apply, because
 * "no login" quietly becoming "no checks" is how a POC ends up writing real rows.
 *
 * `POC_MODE_ENABLED` is read at module load, so each case re-imports the modules
 * with `vi.resetModules()` rather than mutating the constant.
 */

const getSession = vi.hoisted(() => vi.fn());
const createNewHire = vi.hoisted(() => vi.fn());
const writeAuditEvent = vi.hoisted(() => vi.fn());
const classifyAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/session")>(
    "@/lib/auth/session",
  );
  return { ...actual, getSession };
});
vi.mock("@/lib/n8n/client", () => ({ createNewHire }));
vi.mock("@/lib/n8n/classify", () => ({ classifyAdmin }));
vi.mock("@/lib/audit/writer", () => ({ writeAuditEvent }));

const VALID_BODY = {
  tempEmpId: "1303",
  name: "Priya Nair",
  role: "QA Engineer",
  email: "priya.nair@company.com",
};

async function loadRoute(pocMode: boolean) {
  vi.resetModules();
  process.env.NEW_HIRE_POC_MODE = pocMode ? "true" : "false";
  const { POST } = await import("@/app/api/admin/new-hire/route");
  return POST;
}

function post(handler: Awaited<ReturnType<typeof loadRoute>>, body: unknown, requestId: string) {
  return handler(
    new Request("http://localhost/api/admin/new-hire", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  process.env.ADMIN_CONTRACT_VERIFIED = "true";
  process.env.NEW_HIRE_DRY_RUN = "true";
  getSession.mockReset().mockResolvedValue(null);
  createNewHire.mockReset();
  writeAuditEvent.mockReset().mockResolvedValue(undefined);
});

describe("POC mode", () => {
  it("accepts a request with no session when enabled", async () => {
    const POST = await loadRoute(true);
    getSession.mockResolvedValue(null);

    const response = await post(POST, VALID_BODY, "poc-1");

    expect(response.status).toBe(200);
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("accepts a request from a role that could never provision otherwise", async () => {
    const POST = await loadRoute(true);
    getSession.mockResolvedValue({ email: "someone@company.com", role: "new_hire" });

    expect((await post(POST, VALID_BODY, "poc-2")).status).toBe(200);
  });

  it("still refuses an anonymous request when disabled", async () => {
    // The default must stay enforcing: a deploy that never sets the flag keeps
    // its authentication.
    const POST = await loadRoute(false);
    getSession.mockResolvedValue(null);

    const response = await post(POST, VALID_BODY, "poc-3");

    expect(response.status).toBe(401);
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("still refuses a role that is not hr_admin when disabled", async () => {
    const POST = await loadRoute(false);
    getSession.mockResolvedValue({ email: "mgr@company.com", role: "manager" });

    expect((await post(POST, VALID_BODY, "poc-4")).status).toBe(403);
  });

  it("still validates — bypassing auth is not bypassing the schema", async () => {
    const POST = await loadRoute(true);

    const response = await post(POST, { name: "No Id Or Email" }, "poc-5");

    expect(response.status).toBe(400);
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("still refuses a repeated request id", async () => {
    const POST = await loadRoute(true);
    await post(POST, VALID_BODY, "poc-fixed");
    expect((await post(POST, VALID_BODY, "poc-fixed")).status).toBe(409);
  });

  it("still honours the feature flag", async () => {
    process.env.ADMIN_CONTRACT_VERIFIED = "false";
    const POST = await loadRoute(true);

    expect((await post(POST, VALID_BODY, "poc-6")).status).toBe(503);
  });

  it("still honours the dry run, so a demo cannot write to the sheet", async () => {
    const POST = await loadRoute(true);
    const body = await (await post(POST, VALID_BODY, "poc-7")).json();

    expect(body).toMatchObject({ dryRun: true, created: false });
    expect(createNewHire).not.toHaveBeenCalled();
  });

  it("attributes an unauthenticated create to a fixed actor, not to a blank", async () => {
    process.env.NEW_HIRE_DRY_RUN = "false";
    const POST = await loadRoute(true);
    createNewHire.mockResolvedValue({ ok: true, httpStatus: 200, body: { status: "ok" } });
    classifyAdmin.mockReturnValue({
      outcome: "created",
      tempEmpId: "1303",
      message: "created",
      errors: [],
    });

    await post(POST, VALID_BODY, "poc-8");

    // `actor_email` is a compliance field. With no session it still has to name
    // SOMETHING — a trail that says "unknown" on every row is not evidence.
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: "poc@local" }),
    );
  });

  it("refuses a client-supplied actor rather than believing it", async () => {
    const POST = await loadRoute(true);

    // `adminRequestSchema` is `.strict()`, so this 400s before the audit write.
    // Without that, POC mode would let anyone sign their own provisioning rows.
    const response = await post(POST, { ...VALID_BODY, actorEmail: "attacker@evil.test" }, "poc-9");

    expect(response.status).toBe(400);
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });
});